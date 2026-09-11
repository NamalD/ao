#lang racket
(require "../ao/dsl.rkt")
(provide name render)
(define name "Orbs")

(define (render a)
  (define t (audio-frame-time a))
  (define impulse (audio-frame-impulse a))
  (define hue (* .35 t))
  (define loudness (audio-frame-loudness a))
  (scene (color-scale (color-cycle hue) .06)
         (list
          (gradient-circle .5 .5 (+ .65 (* .07 impulse))
                           (color-scale (color-cycle hue) (+ .35 (* .2 impulse)) .18)
                           (color-cycle hue 0))
          (group
           (for/list ([i (in-range 52)])
             (define band (list-ref (audio-frame-spectrum a) (modulo i 48)))
             ;; Layer a broad orbit with two faster, offset wobbles.  Each
             ;; orb gets its own phases, while the band adds a restrained
             ;; audio-reactive nudge instead of making every path repeat.
             (define orbit (+ (* .37 i) (* .19 t)))
             (define drift (+ (* .61 i) (* .13 t)))
             (define wobble (+ (* .83 i) (* .47 t)))
             (define nudge (* (- band .2) .055))
             (define x (+ .5
                          (* .27 (sin orbit))
                          (* .09 (sin (+ drift (* .7 (sin wobble)))))
                          (* nudge (sin (+ (* 1.7 t) i)))))
             (define y (+ .5
                          (* .27 (cos drift))
                          (* .09 (sin (+ orbit (* .6 (cos wobble)))))
                          (* nudge (cos (+ (* 1.3 t) (* 1.9 i))))))
             (define phase (+ hue (* .035 i) (* .8 band)))
             (gradient-circle x y (+ .01 (* .045 band) (* .018 impulse))
                              (color-scale (color-cycle phase) (+ .5 (* .45 band)) (+ .42 (* .25 band)))
                              (color-cycle phase 0)))
           0 0 (+ 1 (* .12 impulse)) 0 1 "add")
          (light .5 .5 (+ .12 (* .12 loudness)) (color-cycle hue) (+ .35 (* .65 loudness))))))
