#lang racket
(require "../ao/dsl.rkt")
(provide name render)

(define name "Ink")

;; Overlapping, slowly moving fields make soft pools feel fluid without a
;; texture or a persistent framebuffer. Audio only nudges the flow, so quiet
;; passages still have a gentle organic drift.
(define (field t seed amount)
  (* amount (+ (* .55 (sin (+ (* .17 t) (* 2.7 seed))))
                 (* .30 (sin (+ (* .31 t) (* 5.1 seed))))
                 (* .15 (cos (+ (* .53 t) (* 8.3 seed)))))))

(define (ink-colour phase energy alpha)
  (color-scale (color-cycle phase alpha) (+ .52 (* .48 energy))))

(define (bloom t i energy)
  (define seed (+ 1 (* .73 i)))
  (define x (+ .5 (field t seed (+ .12 (* .12 (sin seed))))))
  (define y (+ .5 (field (+ (* .8 t) 2.0) seed (+ .14 (* .10 (cos seed))))))
  (define phase (+ (* .35 t) (* .9 seed)))
  (define radius (+ .16 (* .07 (sin (+ seed (* .2 t)))) (* .10 energy)))
  (gradient-circle x y radius
                   (ink-colour phase energy (+ .10 (* .05 energy)))
                   (rgba* 0 0 0 0)))

(define (tendril t i energy)
  (define seed (+ 2 (* 1.17 i)))
  (define points
    (for/list ([j (in-range 30)])
      (define u (/ j 29.0))
      (define x (+ (* .90 u)
                   (* .055 (sin (+ (* 5.0 u) (* .17 t) seed)))))
      (define y (+ .5 (* .40 (sin (+ (* 1.2 u) (* .13 t) seed)))
                  (* .09 (sin (+ (* 7.0 u) (* .23 t) (* 2 seed))))))
      (cons x y)))
  (polyline points (+ .012 (* .018 energy))
            (ink-colour (+ (* .35 t) (* .8 seed)) energy
                        (+ .10 (* .08 (sin seed))))))

(define (render a)
  (define t (audio-frame-time a))
  (define energy (clamp (audio-frame-loudness a)))
  (define spectrum (audio-frame-spectrum a))
  (define pulse (if (null? spectrum)
                    0.0
                    (list-ref spectrum
                              (modulo (inexact->exact (floor (* .7 t)))
                                      (length spectrum)))))
  (define flow (+ energy (* .35 pulse)))
  (scene (color-scale (color-cycle (* .22 t)) (+ .045 (* .025 energy)))
         (list
          (group (for/list ([i (in-range 9)]) (bloom t i flow))
                  0 0 1 0 1 "normal")
          (group (for/list ([i (in-range 5)]) (tendril t i flow))
                  0 0 1 (* .015 (sin (* .11 t))) (+ .65 (* .25 energy)) "screen"))))
