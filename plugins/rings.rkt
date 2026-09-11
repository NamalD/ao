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
             (define orb-hue (+ hue (* .35 level)))
             (gradient-circle (+ .5 (* (+ .14 (* .22 level)) (cos angle)))
                              (+ .5 (* (+ .14 (* .22 level)) (sin angle)))
                              (+ .009 (* .018 level))
                              (color-scale (color-cycle orb-hue) (+ .65 (* .35 level)) .98)
                              ;; Retaining colour and opacity at the rim gives each
                              ;; stretched orb a defined, bead-like silhouette.
                              (color-scale (color-cycle orb-hue) (+ .16 (* .16 level)) .7)))
           0 0 1 (* .11 (audio-frame-time a)) 1 "normal")
          )))
