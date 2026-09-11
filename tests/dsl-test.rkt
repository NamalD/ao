#lang racket
(require rackunit "../ao/dsl.rkt")
(check-equal? (clamp -1) 0.0)
(check-equal? (clamp 2) 1.0)
(check-equal? (lerp 0 10 .25) 2.5)
(check-true (scene? (scene (rgb 0 0 0) '())))
