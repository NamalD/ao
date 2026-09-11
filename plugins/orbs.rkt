#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Orbs")
(define (render a)
  (define t (audio-frame-time a))
  (scene (rgb .018 .008 .025)
         (list
          (gradient-circle .5 .5 .65 (rgba* .16 .01 .3 .18) (rgba* .01 .0 .03 0))
          (group
           (for/list ([i (in-range 52)])
             (define band (list-ref (audio-frame-spectrum a) (modulo i 48)))
             (define x (+ .5 (* .42 (sin (+ (* .37 i) (* .19 t))))) )
             (define y (+ .5 (* .42 (cos (+ (* .61 i) (* .13 t))))) )
             (gradient-circle x y (+ .01 (* .045 band))
                              (rgba* (+ .3 (* .5 band)) .1 (+ .65 (* .3 band)) .58)
                              (rgba* .15 .01 .4 0)))
           0 0 1 0 1 "add"))))
