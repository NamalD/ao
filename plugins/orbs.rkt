#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Orbs")

(define (render a)
  (define t (audio-frame-time a))
  (define hue (* .35 t))
  (define loudness (audio-frame-loudness a))
  (scene (color-scale (color-cycle hue) .06)
         (list
          (gradient-circle .5 .5 .65 (color-scale (color-cycle hue) .35 .18) (color-cycle hue 0))
          (light .5 .5 (+ .12 (* .12 loudness)) (color-cycle hue) (+ .35 (* .65 loudness)))
          (group
           (for/list ([i (in-range 52)])
             (define band (list-ref (audio-frame-spectrum a) (modulo i 48)))
             (define x (+ .5 (* .42 (sin (+ (* .37 i) (* .19 t))))) )
             (define y (+ .5 (* .42 (cos (+ (* .61 i) (* .13 t))))) )
             (define phase (+ hue (* .035 i) (* .8 band)))
             (gradient-circle x y (+ .01 (* .045 band))
                              (color-scale (color-cycle phase) (+ .5 (* .45 band)) (+ .42 (* .25 band)))
                              (color-cycle phase 0)))
           0 0 1 0 1 "add"))))
