#lang racket

(require racket/file racket/list racket/string racket/path racket/format racket/date
         "ao/dsl.rkt" "ao/audio.rkt" "ao/plugins.rkt"
         "ao/window-state.rkt")

(define root (current-directory))
(define state-dir (build-path root "state"))
(define log-path (build-path state-dir "ao.log"))
(make-directory* state-dir)
(define (log! fmt . xs)
  (call-with-output-file log-path #:exists 'append
    (lambda (out) (fprintf out "~a  ~a\n" (date->string (current-date) #t) (apply format fmt xs)))))
(define (state-path) (build-path state-dir "last-plugin.rktd"))
(define (window-position-path) (build-path state-dir "window-position.rktd"))
(define (saved-name) (with-handlers ([exn:fail? (lambda (_) #f)]) (call-with-input-file (state-path) read)))
(define (save-name! name) (call-with-output-file (state-path) #:exists 'truncate (lambda (out) (write name out))))
(define (persist-window-position! position)
  (save-window-position! (window-position-path) position))
(define (u8 x) (inexact->exact (round (* 255 (clamp x)))))
(define (color-lines c) (format "~a ~a ~a ~a" (u8 (rgba-r c)) (u8 (rgba-g c)) (u8 (rgba-b c)) (u8 (rgba-a c))))
(define (apply-transform x y tx ty scale rotation)
  ;; Scene transforms are centered on the viewport so rotating a layer of
  ;; objects around (.5,.5) does not fling it toward the top-left corner.
  (define dx (- x .5)) (define dy (- y .5))
  (values (+ .5 tx (* scale (- (* dx (cos rotation)) (* dy (sin rotation)))))
          (+ .5 ty (* scale (+ (* dx (sin rotation)) (* dy (cos rotation)))))))
(define (node->lines n width height [tx 0.0] [ty 0.0] [scale 1.0] [rotation 0.0] [opacity 1.0] [blend "normal"])
  (define (color c) (color-lines (struct-copy rgba c [a (* opacity (rgba-a c))])))
  (define (xy x y) (define-values (u v) (apply-transform x y tx ty scale rotation)) (values (* width u) (* height v)))
  (define prefix (format "blend ~a\n" blend))
  (cond
    [(group? n)
     (define next-tx (+ tx (group-tx n))) (define next-ty (+ ty (group-ty n)))
     (apply string-append (for/list ([child (group-nodes n)])
       (node->lines child width height next-tx next-ty (* scale (group-scale n)) (+ rotation (group-rotation n)) (* opacity (group-opacity n)) (group-blend n))))]
    [(rect? n)
     (define-values (x y) (xy (rect-x n) (rect-y n)))
     (define c (color (rect-color n)))
     (string-append prefix (format "rect ~a ~a ~a ~a ~a ~a\n" x y (* width scale (rect-width n)) (* height scale (rect-height n)) c c))]
    [(gradient-rect? n)
     (define-values (x y) (xy (gradient-rect-x n) (gradient-rect-y n)))
     (string-append prefix (format "rect ~a ~a ~a ~a ~a ~a\n" x y (* width scale (gradient-rect-width n)) (* height scale (gradient-rect-height n)) (color (gradient-rect-top n)) (color (gradient-rect-bottom n))))]
    [(circle? n)
     (define-values (x y) (xy (circle-x n) (circle-y n)))
     (string-append prefix (format "circle ~a ~a ~a ~a ~a\n" x y (* (min width height) (abs scale) (circle-radius n)) (color (circle-color n)) (color (struct-copy rgba (circle-color n) [a 0.0]))))]
    [(gradient-circle? n)
     (define-values (x y) (xy (gradient-circle-x n) (gradient-circle-y n)))
     (string-append prefix (format "circle ~a ~a ~a ~a ~a\n" x y (* (min width height) (abs scale) (gradient-circle-radius n)) (color (gradient-circle-inner n)) (color (gradient-circle-outer n))))]
    [(light? n)
     (define-values (x y) (xy (light-x n) (light-y n)))
     ;; Lights are always additive, even when nested in a normal group.  The
     ;; source's intensity still follows group opacity and transitions.
     (string-append "blend add\n"
                    (format "light ~a ~a ~a ~a ~a\n"
                            x y (* (min width height) (abs scale) (light-radius n))
                            (color (light-color n)) (* opacity (light-intensity n))))]
    [(line? n)
     (define-values (x1 y1) (xy (line-x1 n) (line-y1 n))) (define-values (x2 y2) (xy (line-x2 n) (line-y2 n)))
     (string-append prefix (format "line ~a ~a ~a ~a ~a ~a\n" x1 y1 x2 y2 (* (min width height) (abs scale) (line-width n)) (color (line-color n))))]
    [(polyline? n)
     (string-append prefix (format "polyline ~a ~a ~a" (length (polyline-points n)) (* (min width height) (abs scale) (polyline-width n)) (color (polyline-color n)))
                    (apply string-append (for/list ([p (polyline-points n)]) (define-values (x y) (xy (car p) (cdr p))) (format " ~a ~a" x y))) "\n")]
    [(sphere3d? n)
     (define-values (u v) (xy (+ .5 (sphere3d-x n)) (+ .5 (sphere3d-y n))))
     (string-append prefix
                    (format "sphere3d ~a ~a ~a ~a ~a\n"
                            (- (/ u width) .5) (- (/ v height) .5)
                            (sphere3d-z n)
                            (* (abs scale) (sphere3d-radius n))
                            (color (sphere3d-color n))))]
    [(varying-polyline? n)
     (define widths (varying-polyline-widths n))
     (unless (= (length widths) (length (varying-polyline-points n)))
       (error 'scene "varying-polyline needs one width per point: ~e" n))
     (string-append prefix
                    (format "polyline-varying ~a ~a" (length (varying-polyline-points n)) (color (varying-polyline-color n)))
                    (apply string-append (for/list ([w widths]) (format " ~a" (* (min width height) (abs scale) w))))
                    (apply string-append (for/list ([p (varying-polyline-points n)])
                                           (define-values (x y) (xy (car p) (cdr p)))
                                           (format " ~a ~a" x y))) "\n")]
    [else (error 'scene "unknown node: ~e" n)]))
(define (write-scene out s width height [old #f] [mix 1.0])
  (define bg (scene-background s))
  (fprintf out "clear ~a\n" (color-lines bg))
  (when old (for ([n (scene-nodes old)]) (display (node->lines n width height 0.0 0.0 1.0 0.0 (- 1.0 mix)) out)))
  (for ([n (scene-nodes s)]) (display (node->lines n width height 0.0 0.0 1.0 0.0 mix) out))
  (display "present\n" out) (flush-output out))

(define started (current-inexact-milliseconds))
(define (now) (/ (- (current-inexact-milliseconds) started) 1000.0))
(define-values (native from-native to-native native-err)
  (subprocess #f #f #f (path->string (build-path root "build" "ao-native"))))
(thread (lambda () (let loop () (define line (read-line native-err 'any)) (unless (eof-object? line) (log! "native: ~a" line) (loop)))))
(start-audio-capture started (lambda (message) (log! "audio: ~a" message)))
(define plugin-dir (build-path root "plugins"))
(define plugins (discover-plugins plugin-dir))
(define selected (or (saved-name) "Depth"))
(define index (or (index-where plugins (lambda (p) (equal? selected (plugin-name p)))) 0))
(define previous #f) (define transition-start -1.0) (define help-until 0.0) (define status-until 0.0)
(define render-width 1280) (define render-height 720)
(define (title! text) (fprintf to-native "title ~a\n" text) (flush-output to-native))
(define (status! text) (fprintf to-native "status ~a\n" text) (flush-output to-native))
(define (restore-window-position!)
  (define position (load-window-position (window-position-path)))
  (when position
    (fprintf to-native "position ~a ~a\n"
             (window-position-x position) (window-position-y position))
    (flush-output to-native)))
(restore-window-position!)
(define next-plugin-scan 0.0)
(define (rescan-plugins!)
  (define selected-name (plugin-name (list-ref plugins index)))
  (define-values (found errors) (rescan-plugins plugin-dir plugins))
  (for ([err errors]) (log! "plugin discovery: ~a" err))
  (unless (null? found)
    (set! plugins found)
    (set! index (or (index-where plugins (lambda (p) (equal? selected-name (plugin-name p))))
                    (min index (sub1 (length plugins)))))))
(define (switch! delta)
  (set! previous (list-ref plugins index))
  (set! index (modulo (+ index delta) (length plugins)))
  (set! transition-start (now))
  (save-name! (plugin-name (list-ref plugins index)))
  (title! (format "Ao — ~a" (plugin-name (list-ref plugins index)))))
(define (handle-events!)
  (let loop ()
    (when (char-ready? from-native)
      (define event (read-line from-native 'any))
      (cond [(equal? event "key j") (switch! -1)]
            [(equal? event "key k") (switch! 1)]
            [(equal? event "key h") (set! help-until (+ (now) 4.0))]
            [(equal? event "key r") (rescan-plugins!) (set! status-until (+ (now) 2.0))]
            [(regexp-match #rx"^size ([0-9]+) ([0-9]+)$" event)
             => (lambda (m) (set! render-width (string->number (list-ref m 1)))
                            (set! render-height (string->number (list-ref m 2))))]
            [(regexp-match #rx"^position (-?[0-9]+) (-?[0-9]+)$" event)
             => (lambda (m) (persist-window-position!
                             (window-position (string->number (list-ref m 1))
                                              (string->number (list-ref m 2)))))]
            [(or (equal? event "key q") (equal? event "key escape")) (exit 0)])
      (loop))))
(with-handlers ([exn:break? (lambda (_) (void))])
 (let loop ()
  (handle-events!)
  (when (>= (now) next-plugin-scan)
    (rescan-plugins!)
    (set! next-plugin-scan (+ (now) 1.0)))
  (define p (list-ref plugins index))
  (define-values (new-p reload-error) (reload-plugin p))
  (when reload-error (log! "reload ~a: ~a" (plugin-name p) reload-error) (title! (format "Ao — reload failed: ~a" reload-error)) (status! (format "Reload failed: ~a" reload-error)))
  (unless (eq? p new-p) (set! plugins (list-set plugins index new-p)) (set! p new-p))
  (define-values (rendered render-error) (run-plugin p (current-audio-frame (now) render-width render-height)))
  (when render-error (log! "frame ~a: ~a" (plugin-name p) render-error) (title! (format "Ao — plugin error: ~a" render-error)) (status! (format "Plugin error: ~a" render-error)))
  (define current-scene (or (plugin-last-scene rendered) (scene (rgb 0 0 0) '())))
  (define mix (min 1.0 (/ (- (now) transition-start) .3)))
  (write-scene to-native current-scene render-width render-height (and previous (plugin-last-scene previous)) mix)
  (when (> (now) (+ transition-start .3)) (set! previous #f))
  (when (and (> help-until (now)) (> (now) (- help-until 3.98))) (title! "Ao — controls") (display "help 1\n" to-native) (flush-output to-native))
  (when (and (> (now) help-until) (positive? help-until)) (set! help-until 0.0) (display "help 0\n" to-native) (flush-output to-native) (title! (format "Ao — ~a" (plugin-name p))))
  (sleep .01)
  (loop)))
