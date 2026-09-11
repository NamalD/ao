#lang racket
(require "../ao/dsl.rkt")
(provide name render)

(define name "Rothko")

(define (render a)
  (define energy (clamp (audio-frame-loudness a)))
  (define impulse (audio-frame-impulse a))
  (define hue (* .35 (audio-frame-time a)))
  (define drift (* .012 (sin (* .23 (audio-frame-time a)))))
  (define glow (+ .58 (* .26 energy) (* .12 impulse)))
  (scene (color-scale (color-cycle hue) .13)
         (list
          (rect (- .07 (* .025 impulse)) (- .06 (* .025 impulse))
                (+ .86 (* .05 impulse)) (+ .22 drift (* .05 impulse))
                (color-scale (color-cycle (+ hue .5)) (+ .32 (* .12 impulse)) .72))
          (rect .10 (+ .25 drift) .80 .27 (color-scale (color-cycle (+ hue 1.5)) .78 glow))
          (rect .08 (+ .55 (* -0.6 drift)) .84 .30
                (color-scale (color-cycle (+ hue 3.0)) .28 (+ .62 (* .18 energy))))
          (rect .14 (+ .62 (* -0.8 drift)) .72 .15
                (color-scale (color-cycle (+ hue 2.2)) .55 (+ .22 (* .24 energy)))))))
