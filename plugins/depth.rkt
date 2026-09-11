#lang racket
(require "../ao/dsl.rkt")
(provide name render)

(define name "Depth")

;; Emit far-to-near so projected objects naturally occlude one another.
(define (render a)
  (define t (audio-frame-time a))
  (define loudness (audio-frame-loudness a))
  (define impulse (audio-frame-impulse a))
  (define hue (* .28 t))
  (define objects
    (sort
     (for/list ([i (in-range 42)])
       (define phase (+ (* .47 i) (* .35 t)))
       (define z (+ .08 (* .84 (/ i 41.0))))
       (define band (list-ref (audio-frame-spectrum a) (modulo i 48)))
       (list z
             (sphere3d (* .72 (sin phase))
                       (* .48 (cos (+ phase (* .31 t))))
                       z
                       (+ .012 (* .025 band) (* .018 impulse))
                       (color-scale (color-cycle (+ hue (* .045 i)))
                                    (+ .42 (* .42 band))
                                    (+ .35 (* .35 band))))))
     (lambda (a b) (< (first a) (first b)))))
  (scene (color-scale (color-cycle (+ hue .4)) (+ .035 (* .025 loudness)))
         (append (list (light .5 .5 (+ .1 (* .12 loudness))
                                  (color-cycle hue) (+ .25 (* .55 loudness))))
                 (map second objects))))
