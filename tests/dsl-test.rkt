#lang racket
(require rackunit racket/file racket/runtime-path "../ao/dsl.rkt" "../ao/audio.rkt" "../ao/plugins.rkt" "../ao/window-state.rkt")
(check-equal? (clamp -1) 0.0)
(check-equal? (clamp 2) 1.0)
(check-equal? (lerp 0 10 .25) 2.5)
(check-equal? (rgba-a (color-cycle 0 .4)) .4)
(check-not-equal? (color-cycle 0) (color-cycle pi))
(check-equal? (color-scale (rgba* .5 .25 1 .8) .4) (rgba* .2 .1 .4 .8))
(check-true (scene? (scene (rgb 0 0 0) '())))
(check-true (gradient-circle? (gradient-circle .5 .5 .1 (rgb 1 0 0) (rgba* 1 0 0 0))))
(check-true (gradient-rect? (gradient-rect 0 0 1 1 (rgb 0 0 0) (rgb 1 1 1))))
(check-true (sphere3d? (sphere3d 0 0 .5 .1 (rgb 1 0 0))))
(check-true (group? (group '() 0 0 1 0 1 "add")))
(define test-light (light .25 .75 .2 (rgba* 1 .5 0 .8) 1.5))
(check-true (light? test-light))
(check-equal? (light-radius test-light) .2)
(check-equal? (light-intensity test-light) 1.5)

;; Orbs should cycle through colours over time rather than stay in one hue.
(define-runtime-path orbs-plugin "../plugins/orbs.rkt")
(define-runtime-path rings-plugin "../plugins/rings.rkt")
(define-runtime-path wave-plugin "../plugins/wave.rkt")
(define-runtime-path rothko-plugin "../plugins/rothko.rkt")
(define-runtime-path ink-plugin "../plugins/ink.rkt")
(define-runtime-path depth-plugin "../plugins/depth.rkt")
(define-runtime-path dunes-plugin "../plugins/dunes.rkt")
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
(check-true (> (group-scale (second (scene-nodes (orbs-render impact-frame)))) 1))

(define impact-ring-group (first (scene-nodes (rings-render impact-frame))))
(check-true (> (group-scale impact-ring-group) 1))
(check-true (> (gradient-circle-radius (first (group-nodes impact-ring-group)))
               (gradient-circle-radius (first (group-nodes (first (scene-nodes (rings-render quiet-frame))))))))
(define quiet-ring-orbs (group-nodes (first (scene-nodes (rings-render quiet-frame)))))
(define quiet-ring-orb (first quiet-ring-orbs))
(define loud-ring-orb (first (group-nodes (first (scene-nodes (rings-render loud-rings-frame))))))
(check-not-equal? (gradient-circle-inner quiet-ring-orb)
                  (gradient-circle-inner (second quiet-ring-orbs)))
(check-not-equal? (gradient-circle-inner quiet-ring-orb) (gradient-circle-inner loud-ring-orb))
;; Ring orbs should dissolve at the edge instead of retaining a hard bead rim.
(check-equal? (rgba-a (gradient-circle-outer quiet-ring-orb)) 0)
(check-equal? (group-blend (first (scene-nodes (rings-render quiet-frame)))) "add")
(check-equal? (length (scene-nodes (rings-render quiet-frame))) 1)
(check-equal? (length (group-nodes (first (scene-nodes (rings-render quiet-frame))))) 28)

;; Orbs take gently irregular, audio-reactive paths rather than repeating one
;; fixed left-to-right track.  A stronger first band shifts its first orb.
(define active-frame
  (audio-frame 0 '() '() (cons .2 (cons .9 (make-list 46 .2))) 0 0 0 0 1280 720))
(define early-orb-2 (second (group-nodes (second (scene-nodes (orbs-render quiet-frame))))))
(define active-orb-2 (second (group-nodes (second (scene-nodes (orbs-render active-frame))))))
(check-not-equal? (gradient-circle-x early-orb-2) (gradient-circle-x active-orb-2))
(check-not-equal? (gradient-circle-y early-orb-2) (gradient-circle-y active-orb-2))

(for ([plugin-path (list orbs-plugin rings-plugin wave-plugin rothko-plugin ink-plugin depth-plugin dunes-plugin)])
  (define render (dynamic-require plugin-path 'render))
  (check-not-equal? (scene-background (render quiet-frame))
                    (scene-background (render later-frame))))

(define depth-render (dynamic-require depth-plugin 'render))
(define depth-scene (depth-render quiet-frame))
(check-equal? (length (scene-nodes depth-scene)) 43)
(check-true (sphere3d? (second (scene-nodes depth-scene))))

;; Dunes is a layered journey scene: broad terrain ribbons, wind, and a
;; foreground drone all remain present in a quiet frame.
(define dunes-render (dynamic-require dunes-plugin 'render))
(define dunes-scene (dunes-render quiet-frame))
(check-equal? (dynamic-require dunes-plugin 'name) "Dunes")
(check-true (>= (length (scene-nodes dunes-scene)) 20))
(check-true (gradient-rect? (first (scene-nodes dunes-scene))))
(check-true (varying-polyline? (fourth (scene-nodes dunes-scene))))
(check-true (group? (list-ref (scene-nodes dunes-scene) 19)))

;; Wave uses the full capture resolution and filters the raw waveform so its
;; animated sine line remains visually continuous instead of faceting.
(define wave-render (dynamic-require wave-plugin 'render))
(define jagged-frame
  (audio-frame 0 (for/list ([i (in-range 256)]) (if (even? i) -1.0 1.0)) '()
               (make-list 48 0.0) 0 0 0 0 1280 720))
(define wave-line (first (group-nodes (third (scene-nodes (wave-render jagged-frame))))))
(define wave-points (varying-polyline-points wave-line))
(check-equal? (length wave-points) 256)
;; At an alternating peak, the centre-weighted filter yields 0.2 rather than
;; the raw 1.0 sample.
(define peak-x (/ 3.0 255.0))
(check-= (cdr (list-ref wave-points 3))
         (+ .5 (* .24 .2) (* .08 (sin (* 9 peak-x))))
         1e-9)
(define wave-widths (varying-polyline-widths wave-line))
(define later-wave-line (first (group-nodes (third (scene-nodes (wave-render later-frame))))))
(check-not-equal? wave-widths (varying-polyline-widths later-wave-line))
(check-true (> (max (apply max (varying-polyline-widths
                                (first (group-nodes (third (scene-nodes (wave-render impact-frame))))))))
               (max (apply max wave-widths))))
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

;; Window placement survives restart and accepts negative coordinates for a
;; monitor positioned to the left or above the primary display.
(define position-path (make-temporary-file "ao-position~a.rktd" #f (current-directory)))
(define position (window-position -640 120))
(save-window-position! position-path position)
(check-equal? (load-window-position position-path) position)
(delete-file position-path)

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
