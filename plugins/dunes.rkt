#lang racket
(require "../ao/dsl.rkt")
(provide name render)

(define name "Dunes")

(define (band spectrum i)
  (if (null? spectrum) 0.0 (list-ref spectrum (modulo i (length spectrum)))))

(define (dune-points t layer base amplitude)
  (for/list ([i (in-range 25)])
    (define u (/ i 24.0))
    (cons (- (* 1.2 u) .1)
          (+ base
             (* amplitude (sin (+ (* 2.2 u) (* .72 layer) (* .11 t))))
             (* .018 (sin (+ (* 6.0 u) (* .31 layer) (* .17 t))))))))

(define (crest-points points width)
  (for/list ([point points])
    (cons (car point) (- (cdr point) (* .5 width)))))

(define (dune-layer t layer base width colour energy)
  (define points (dune-points t layer base (+ .025 (* .035 energy))))
  (list
   (varying-polyline points (make-list (length points) width) colour)
   (polyline (crest-points points width) .006
             (color-scale colour (+ .55 (* .25 energy)) .55))))

(define (wind-streak t i energy)
  (define y (+ .43 (* .045 i) (* .018 (sin (+ (* .27 t) i)))))
  (define x (+ .08 (* .17 (modulo i 4)) (* .025 (sin (+ t i)))))
  (polyline (for/list ([j (in-range 7)])
              (define u (/ j 6.0))
              (cons (+ x (* .18 u))
                    (+ y (* .012 (sin (+ (* 4.0 u) i (* .2 t)))))))
            (+ .002 (* .003 energy))
            (rgba* .96 .65 .31 (+ .08 (* .08 energy)))))

(define (drone t energy impulse)
  (define bob (+ .36 (* .018 (sin (* .8 t))) (* .012 impulse)))
  (define tilt (* .035 (sin (+ (* .6 t) (* 2 energy)))))
  (define body (rgba* .92 .75 .38 (+ .72 (* .2 energy))))
  (define rotor (rgba* .98 .55 .2 (+ .35 (* .35 energy))))
  (group
   (list
    (line .455 .38 .545 .38 .008 body)
    (line .475 .365 .455 .38 .006 body)
    (line .525 .365 .545 .38 .006 body)
    (circle .5 .375 .018 body)
    (gradient-circle .455 .36 .012 rotor (rgba* .98 .55 .2 0))
    (gradient-circle .545 .36 .012 rotor (rgba* .98 .55 .2 0))
    (polyline (list (cons .435 .345) (cons .475 .345)) .003 rotor)
    (polyline (list (cons .525 .345) (cons .565 .345)) .003 rotor))
   0 bob 1 tilt .95 "add"))

(define (render a)
  (define t (audio-frame-time a))
  (define energy (clamp (audio-frame-loudness a)))
  (define impulse (clamp (audio-frame-impulse a)))
  (define spectrum (audio-frame-spectrum a))
  (define travel (* .06 (sin (+ (* .13 t) (* .8 (band spectrum 3))))))
  (define far (dune-layer (+ t (* 2 travel)) 0 .62 .18 (rgba* .26 .12 .10 .9) energy))
  (define middle (dune-layer (+ (* 1.15 t) (* 5 travel)) 1 .76 .34 (rgba* .48 .22 .10 .98) energy))
  (define near (dune-layer (+ (* .8 t) (* 9 travel)) 2 .94 .56 (rgba* .72 .36 .13 1) energy))
  (scene (rgba* (+ .025 (* .004 (sin (* .16 t)))) .035 .10 1)
         (append
          (list
           (gradient-rect 0 0 1 1
                          (rgba* .025 .035 .11 1)
                          (rgba* .74 .35 .12 1))
           (gradient-circle (+ .73 (* .025 (sin (* .08 t))))
                            (+ .23 (* .018 (sin (* .11 t))))
                            (+ .105 (* .025 energy) (* .03 impulse))
                            (rgba* 1 .68 .26 (+ .42 (* .2 energy)))
                            (rgba* 1 .38 .10 0))
           (gradient-rect 0 .43 1 .22
                          (rgba* .87 .49 .20 .10)
                          (rgba* .94 .47 .16 .22)))
          far
          middle
          near
          (for/list ([i (in-range 10)]) (wind-streak t i energy))
          (list (drone t energy impulse)
                (light .73 .23 (+ .08 (* .04 energy)) (rgba* 1 .38 .1 1)
                       (+ .2 (* .4 energy)))))))
