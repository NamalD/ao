#lang racket
(require "../ao/dsl.rkt")
(provide name render)

(define name "Rothko")

(define (render a)
  (define energy (clamp (audio-frame-loudness a)))
  (define drift (* .012 (sin (* .23 (audio-frame-time a)))))
  (define glow (+ .58 (* .26 energy)))
  (scene (rgb .13 .018 .026)
         (list
          (rect .07 .06 .86 (+ .22 drift) (rgba* .31 .035 .055 .72))
          (rect .10 (+ .25 drift) .80 .27 (rgba* .73 .18 .12 glow))
          (rect .08 (+ .55 (* -0.6 drift)) .84 .30
                (rgba* .12 .025 .045 (+ .62 (* .18 energy))))
          (rect .14 (+ .62 (* -0.8 drift)) .72 .15
                (rgba* .46 .055 .07 (+ .22 (* .24 energy)))))))
