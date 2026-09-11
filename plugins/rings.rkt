#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Rings")
(define (render a)
  (define hue (* .35 (audio-frame-time a)))
  (scene (color-scale (color-cycle hue) .045)
         (list
          (group
           (for/list ([i (in-range 28)])
             (define angle (* i (/ (* 2 pi) 28)))
             (define level (list-ref (audio-frame-spectrum a) (modulo (* i 2) 48)))
             (gradient-circle (+ .5 (* (+ .14 (* .22 level)) (cos angle)))
                              (+ .5 (* (+ .14 (* .22 level)) (sin angle)))
                              (+ .006 (* .027 level))
                              (color-scale (color-cycle (+ hue (* .08 i))) (+ .55 (* .45 level)) .95)
                              (color-cycle (+ hue (* .08 i)) 0)))
           0 0 1 (* .11 (audio-frame-time a)) 1 "add")
          )))
