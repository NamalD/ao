#lang racket
(require rackunit "../ao/dsl.rkt" "../ao/audio.rkt")
(check-equal? (clamp -1) 0.0)
(check-equal? (clamp 2) 1.0)
(check-equal? (lerp 0 10 .25) 2.5)
(check-true (scene? (scene (rgb 0 0 0) '())))

;; Regression for the idle-only bug: subprocess must receive /usr/bin/pw-record
;; (or equivalent), not the bare string that a shell would resolve via PATH.
(define capture (pw-record-command "test.monitor" "/usr/bin/pw-record"))
(check-equal? (car capture) "/usr/bin/pw-record")
(check-equal? (cadr capture) "--target")
(check-equal? (caddr capture) "test.monitor")
