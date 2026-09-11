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
         (list (polyline points (+ .003 (* .012 (audio-frame-loudness a))) (rgba* .05 .95 .82 .85)))))
