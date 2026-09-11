#lang racket
(require rackunit racket/file racket/runtime-path "../ao/dsl.rkt" "../ao/audio.rkt" "../ao/plugins.rkt")
(check-equal? (clamp -1) 0.0)
(check-equal? (clamp 2) 1.0)
(check-equal? (lerp 0 10 .25) 2.5)
(check-equal? (rgba-a (color-cycle 0 .4)) .4)
(check-not-equal? (color-cycle 0) (color-cycle pi))
(check-equal? (color-scale (rgba* .5 .25 1 .8) .4) (rgba* .2 .1 .4 .8))
(check-true (scene? (scene (rgb 0 0 0) '())))
(check-true (gradient-circle? (gradient-circle .5 .5 .1 (rgb 1 0 0) (rgba* 1 0 0 0))))
(check-true (gradient-rect? (gradient-rect 0 0 1 1 (rgb 0 0 0) (rgb 1 1 1))))
(check-true (group? (group '() 0 0 1 0 1 "add")))

;; Orbs should cycle through colours over time rather than stay in one hue.
(define-runtime-path orbs-plugin "../plugins/orbs.rkt")
(define-runtime-path rings-plugin "../plugins/rings.rkt")
(define-runtime-path wave-plugin "../plugins/wave.rkt")
(define-runtime-path rothko-plugin "../plugins/rothko.rkt")
(define orbs-render (dynamic-require orbs-plugin 'render))
(define rings-render (dynamic-require rings-plugin 'render))
(define rothko-render (dynamic-require rothko-plugin 'render))
(define quiet-frame
  (audio-frame 0 '() '() (make-list 48 .2) 0 0 0 0 1280 720))
(define later-frame
  (audio-frame 8 '() '() (make-list 48 .2) 0 0 0 0 1280 720))
(define early-orb (first (group-nodes (second (scene-nodes (orbs-render quiet-frame))))))
(define later-orb (first (group-nodes (second (scene-nodes (orbs-render later-frame))))))
(check-not-equal? (gradient-circle-inner early-orb) (gradient-circle-inner later-orb))
(define loud-rings-frame
  (audio-frame 0 '() '() (make-list 48 .9) 0 0 0 0 1280 720))
(define impact-frame
  (audio-frame 0 '() '() (make-list 48 .2) 0 1 0 0 1280 720))
(check-equal? (audio-frame-impulse impact-frame) 1)

;; A transient should visibly punch every visualiser, independently of the
;; slower loudness and spectrum controls.
(define impact-orb (first (group-nodes (second (scene-nodes (orbs-render impact-frame))))))
(define quiet-orb (first (group-nodes (second (scene-nodes (orbs-render quiet-frame))))))
(check-true (> (gradient-circle-radius impact-orb)
               (gradient-circle-radius quiet-orb)))
(check-true (> (group-scale (first (scene-nodes (orbs-render impact-frame)))) 1))

(define impact-ring-group (first (scene-nodes (rings-render impact-frame))))
(check-true (> (group-scale impact-ring-group) 1))
(check-true (> (gradient-circle-radius (first (group-nodes impact-ring-group)))
               (gradient-circle-radius (first (group-nodes (first (scene-nodes (rings-render quiet-frame))))))))
(define quiet-ring-orbs (group-nodes (first (scene-nodes (rings-render quiet-frame)))))
(define quiet-ring-orb (first quiet-ring-orbs))
(define loud-ring-orb (first (group-nodes (first (scene-nodes (rings-render loud-rings-frame))))))
(check-equal? (gradient-circle-inner quiet-ring-orb)
              (gradient-circle-inner (second quiet-ring-orbs)))
(check-not-equal? (gradient-circle-inner quiet-ring-orb) (gradient-circle-inner loud-ring-orb))
(check-equal? (length (scene-nodes (rings-render quiet-frame))) 1)
(check-equal? (length (group-nodes (first (scene-nodes (rings-render quiet-frame))))) 28)
(for ([plugin-path (list orbs-plugin rings-plugin wave-plugin rothko-plugin)])
  (define render (dynamic-require plugin-path 'render))
  (check-not-equal? (scene-background (render quiet-frame))
                    (scene-background (render later-frame))))

;; Wave uses the full capture resolution and filters the raw waveform so its
;; animated sine line remains visually continuous instead of faceting.
(define wave-render (dynamic-require wave-plugin 'render))
(define jagged-frame
  (audio-frame 0 (for/list ([i (in-range 256)]) (if (even? i) -1.0 1.0)) '()
               (make-list 48 0.0) 0 0 0 0 1280 720))
(define wave-line (first (group-nodes (third (scene-nodes (wave-render jagged-frame))))))
(define wave-points (polyline-points wave-line))
(check-equal? (length wave-points) 256)
;; At an alternating peak, the centre-weighted filter yields 0.2 rather than
;; the raw 1.0 sample.
(define peak-x (/ 3.0 255.0))
(check-= (cdr (list-ref wave-points 3))
         (+ .5 (* .24 .2) (* .08 (sin (* 9 peak-x))))
         1e-9)
(define impact-wave-line (first (group-nodes (third (scene-nodes (wave-render impact-frame))))))
(check-true (> (polyline-width impact-wave-line) (polyline-width wave-line)))
(define quiet-rothko-first (first (scene-nodes (rothko-render quiet-frame))))
(define impact-rothko-first (first (scene-nodes (rothko-render impact-frame))))
(check-true (> (rect-width impact-rothko-first)
               (rect-width quiet-rothko-first)))

;; Regression for the idle-only bug: subprocess must receive /usr/bin/parec
;; (or equivalent), not the bare string that a shell would resolve via PATH.
(define capture (parec-command "test.monitor" "/usr/bin/parec"))
(check-equal? (car capture) "/usr/bin/parec")
(check-equal? (cadr capture) "--device")
(check-equal? (caddr capture) "test.monitor")

;; Newly added plugin files are discovered without replacing loaded plugins.
(define plugin-dir (make-temporary-file "ao-plugin-test~a" 'directory (current-directory)))
(define plugin-path (build-path plugin-dir "new.rkt"))
(call-with-output-file plugin-path
  (lambda (out)
    (display "#lang racket\n(provide name render)\n(define name \"New\")\n(define (render a) #f)\n" out)))
(define-values (discovered discovery-errors) (rescan-plugins plugin-dir '()))
(check-equal? discovery-errors '())
(check-equal? (map plugin-name discovered) '("New"))
(define-values (rescanned rescan-errors) (rescan-plugins plugin-dir discovered))
(check-equal? rescan-errors '())
(check-true (eq? (car discovered) (car rescanned)))
(delete-directory/files plugin-dir)
