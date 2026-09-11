#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Ribbon")
(define (render a)
  (define t (audio-frame-time a))
  (define hue (* .35 t))
  (define wave (audio-frame-waveform-left a))
  (define points
    (for/list ([i (in-range 96)])
      (define x (/ i 95.0))
      (define s (if (< i (length wave)) (list-ref wave i) 0.0))
      (cons x (+ .5 (* .24 s) (* .08 (sin (+ (* 9 x) t)))))))
  (scene (color-scale (color-cycle hue) .035)
         (list
          (gradient-rect 0 0 1 1 (color-scale (color-cycle hue) .035) (color-scale (color-cycle (+ hue .7)) .10))
          (gradient-circle .5 .5 (+ .35 (* .25 (audio-frame-loudness a))) (color-scale (color-cycle (+ hue .3)) .55 .12) (color-cycle hue 0))
          (group (list (polyline points (+ .005 (* .018 (audio-frame-loudness a))) (color-scale (color-cycle (+ hue 1.2)) .95 .88)))
                 0 0 1 0 1 "add"))))
