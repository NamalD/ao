#lang racket

(require racket/file racket/list racket/string racket/path racket/format racket/date
         "ao/dsl.rkt" "ao/audio.rkt" "ao/plugins.rkt")

(define root (current-directory))
(define state-dir (build-path root "state"))
(define log-path (build-path state-dir "ao.log"))
(make-directory* state-dir)
(define (log! fmt . xs)
  (call-with-output-file log-path #:exists 'append
    (lambda (out) (fprintf out "~a  ~a\n" (date->string (current-date) #t) (apply format fmt xs)))))
(define (state-path) (build-path state-dir "last-plugin.rktd"))
(define (saved-name) (with-handlers ([exn:fail? (lambda (_) #f)]) (call-with-input-file (state-path) read)))
(define (save-name! name) (call-with-output-file (state-path) #:exists 'truncate (lambda (out) (write name out))))
(define (u8 x) (inexact->exact (round (* 255 (clamp x)))))
(define (color-lines c) (format "~a ~a ~a ~a" (u8 (rgba-r c)) (u8 (rgba-g c)) (u8 (rgba-b c)) (u8 (rgba-a c))))
(define (point->xy p width height) (values (* width (car p)) (* height (cdr p))))
(define (node->line n width height [opacity 1.0])
  (define (c-line tag c) (string-append tag " " (color-lines (struct-copy rgba c [a (* opacity (rgba-a c))]))))
  (cond
    [(rect? n) (format "~a\n" (c-line (format "rect ~a ~a ~a ~a" (* width (rect-x n)) (* height (rect-y n)) (* width (rect-width n)) (* height (rect-height n))) (rect-color n)))]
    [(circle? n) (format "circle ~a ~a ~a ~a\n" (* width (circle-x n)) (* height (circle-y n)) (* (min width height) (circle-radius n)) (color-lines (struct-copy rgba (circle-color n) [a (* opacity (rgba-a (circle-color n)))])))]
    [(line? n) (format "line ~a ~a ~a ~a ~a ~a\n" (* width (line-x1 n)) (* height (line-y1 n)) (* width (line-x2 n)) (* height (line-y2 n)) (* (min width height) (line-width n)) (color-lines (struct-copy rgba (line-color n) [a (* opacity (rgba-a (line-color n)))])))]
    [(polyline? n)
     (string-append (format "polyline ~a ~a ~a" (length (polyline-points n)) (* (min width height) (polyline-width n)) (color-lines (struct-copy rgba (polyline-color n) [a (* opacity (rgba-a (polyline-color n)))])))
                    (apply string-append (for/list ([p (polyline-points n)]) (define-values (x y) (point->xy p width height)) (format " ~a ~a" x y))) "\n")]
    [else (error 'scene "unknown node: ~e" n)]))
(define (write-scene out s [old #f] [mix 1.0])
  (define bg (scene-background s))
  (fprintf out "clear ~a\n" (color-lines bg))
  (when old (for ([n (scene-nodes old)]) (display (node->line n 1280 720 (- 1.0 mix)) out)))
  (for ([n (scene-nodes s)]) (display (node->line n 1280 720 mix) out))
  (display "present\n" out) (flush-output out))

(define started (current-inexact-milliseconds))
(define (now) (/ (- (current-inexact-milliseconds) started) 1000.0))
(define-values (native from-native to-native native-err)
  (subprocess #f #f #f (path->string (build-path root "build" "ao-native"))))
(thread (lambda () (let loop () (define line (read-line native-err 'any)) (unless (eof-object? line) (log! "native: ~a" line) (loop)))))
(start-audio-capture started)
(define plugins (discover-plugins (build-path root "plugins")))
(define selected (or (saved-name) "Rings"))
(define index (or (index-where plugins (lambda (p) (equal? selected (plugin-name p)))) 0))
(define previous #f) (define transition-start -1.0) (define help-until 0.0) (define status-until 0.0)
(define (title! text) (fprintf to-native "title ~a\n" text) (flush-output to-native))
(define (status! text) (fprintf to-native "status ~a\n" text) (flush-output to-native))
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
            [(equal? event "key r") (set! status-until (+ (now) 2.0))]
            [(or (equal? event "key q") (equal? event "key escape")) (exit 0)])
      (loop))))
(let loop ()
  (handle-events!)
  (define p (list-ref plugins index))
  (define-values (new-p reload-error) (reload-plugin p))
  (when reload-error (log! "reload ~a: ~a" (plugin-name p) reload-error) (title! (format "Ao — reload failed: ~a" reload-error)) (status! (format "Reload failed: ~a" reload-error)))
  (unless (eq? p new-p) (set! plugins (list-set plugins index new-p)) (set! p new-p))
  (define-values (rendered render-error) (run-plugin p (current-audio-frame (now) 1280 720)))
  (when render-error (log! "frame ~a: ~a" (plugin-name p) render-error) (title! (format "Ao — plugin error: ~a" render-error)) (status! (format "Plugin error: ~a" render-error)))
  (define current-scene (or (plugin-last-scene rendered) (scene (rgb 0 0 0) '())))
  (define mix (min 1.0 (/ (- (now) transition-start) .3)))
  (write-scene to-native current-scene (and previous (plugin-last-scene previous)) mix)
  (when (> (now) (+ transition-start .3)) (set! previous #f))
  (when (and (> help-until (now)) (> (now) (- help-until 3.98))) (title! "Ao — controls") (display "help 1\n" to-native) (flush-output to-native))
  (when (and (> (now) help-until) (positive? help-until)) (set! help-until 0.0) (display "help 0\n" to-native) (flush-output to-native) (title! (format "Ao — ~a" (plugin-name p))))
  (sleep .01)
  (loop))
