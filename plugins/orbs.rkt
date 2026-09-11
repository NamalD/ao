#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Orbs")

;; Three phase-shifted waves produce a continuous colour cycle without adding
;; another colour type to the public plugin DSL.
(define (orb-colour phase energy alpha)
  (define (channel offset)
    (+ .16 (* (+ .34 (* .5 energy))
              (max 0 (sin (+ phase offset))))))
  (rgba* (channel 0) (channel (/ (* 2 pi) 3)) (channel (/ (* 4 pi) 3)) alpha))

(define (render a)
  (define t (audio-frame-time a))
  (define hue (* .22 t))
  (define backdrop (orb-colour hue 0 1))
  (scene (rgba* (* .09 (rgba-r backdrop)) (* .09 (rgba-g backdrop)) (* .09 (rgba-b backdrop)))
         (list
          (gradient-circle .5 .5 .65 (orb-colour hue .15 .18) (orb-colour hue 0 0))
          (group
           (for/list ([i (in-range 52)])
             (define band (list-ref (audio-frame-spectrum a) (modulo i 48)))
             (define x (+ .5 (* .42 (sin (+ (* .37 i) (* .19 t))))) )
             (define y (+ .5 (* .42 (cos (+ (* .61 i) (* .13 t))))) )
             (define phase (+ hue (* .31 i) (* .8 band)))
             (gradient-circle x y (+ .01 (* .045 band))
                              (orb-colour phase band (+ .42 (* .25 band)))
                              (orb-colour phase band 0)))
           0 0 1 0 1 "add"))))
