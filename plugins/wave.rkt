#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Wave")
(define sample-count 256)

;; The capture is a raw waveform, so adjacent samples can differ sharply even
;; when the signal beneath them is smooth.  A small, centre-weighted filter
;; keeps the wave fluid without disconnecting it from the music.
(define (smoothed-sample wave i)
  (define (sample offset)
    (define index (max 0 (min (sub1 (length wave)) (+ i offset))))
    (if (null? wave) 0.0 (list-ref wave index)))
  (/ (+ (sample -2) (* 2 (sample -1)) (* 4 (sample 0))
        (* 2 (sample 1)) (sample 2))
     10.0))

(define (render a)
  (define t (audio-frame-time a))
  (define wave (audio-frame-waveform-left a))
  (define points
    (for/list ([i (in-range sample-count)])
      (define x (/ i (sub1 sample-count)))
      (define s (smoothed-sample wave i))
      (cons x (+ .5 (* .24 s) (* .08 (sin (+ (* 9 x) t)))))))
  (scene (rgb .005 .015 .025)
         (list
          (gradient-rect 0 0 1 1 (rgba* .005 .015 .025 1) (rgba* .0 .05 .075 1))
          (gradient-circle .5 .5 (+ .35 (* .25 (audio-frame-loudness a))) (rgba* .02 .4 .5 .12) (rgba* .01 .05 .1 0))
          (group (list (polyline points (+ .005 (* .018 (audio-frame-loudness a))) (rgba* .05 .95 .82 .88)))
                 0 0 1 0 1 "add"))))
