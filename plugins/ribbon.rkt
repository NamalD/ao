#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Ribbon")
(define (render a)
  (define t (audio-frame-time a))
  (define wave (audio-frame-waveform-left a))
  (define points
    (for/list ([i (in-range 96)])
      (define x (/ i 95.0))
      (define s (if (< i (length wave)) (list-ref wave i) 0.0))
      (cons x (+ .5 (* .24 s) (* .08 (sin (+ (* 9 x) t)))))))
  (scene (rgb .005 .015 .025)
         (list
          (gradient-rect 0 0 1 1 (rgba* .005 .015 .025 1) (rgba* .0 .05 .075 1))
          (gradient-circle .5 .5 (+ .35 (* .25 (audio-frame-loudness a))) (rgba* .02 .4 .5 .12) (rgba* .01 .05 .1 0))
          (group (list (polyline points (+ .005 (* .018 (audio-frame-loudness a))) (rgba* .05 .95 .82 .88)))
                 0 0 1 0 1 "add"))))
