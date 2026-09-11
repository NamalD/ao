#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Rings")
(define (render a)
  (define t (audio-frame-time a))
  (define hue (* .35 (audio-frame-time a)))
  (define impulse (audio-frame-impulse a))
  (scene (color-scale (color-cycle hue) .045)
         (list
          (group
           (for/list ([i (in-range 28)])
             (define angle (* i (/ (* 2 pi) 28)))
             (define level (list-ref (audio-frame-spectrum a) (modulo (* i 2) 48)))
             ;; Give each orb a stable colour identity and a little independent
             ;; movement, while the spectrum and impulse still drive the main
             ;; ring shape.
             (define orb-phase (+ (* .08 i) (* .35 level)))
             (define wobble (sin (+ (* .7 i) (* .9 t))))
             (define orb-hue (+ hue orb-phase))
             (define orbit (+ .14 (* .22 level) (* .018 wobble) (* .06 impulse)))
             (define radius (+ .006
                               (* .018 level)
                               (* .006 (+ 1 (sin (+ (* 1.3 i) t))))
                               (* .014 impulse)))
             (gradient-circle (+ .5 (* orbit (cos angle)))
                              (+ .5 (* orbit (sin angle)))
                              radius
                              (color-scale (color-cycle orb-hue) (+ .55 (* .45 level)) .95)
                              (color-cycle orb-hue 0)))
           0 0 (+ 1 (* .16 impulse)) (* .11 t) 1 "add")
          )))
