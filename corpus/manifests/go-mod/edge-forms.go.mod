module example.invalid/team/edge

go 1.21
toolchain go1.21.5

require github.com/Masterminds/semver/v3 v3.2.1
require github.com/old/lib v2.7.0+incompatible

require (
	example.invalid/team/fresh v0.0.0-20240102030405-abcdef123456
	github.com/stretchr/testify v1.9.0 // direct, with a note
	github.com/Masterminds/semver/v3 v3.0.0
)

replace github.com/old/lib => ../old-lib

exclude github.com/bad/lib v1.0.0

retract (
	v1.0.0
	v1.0.1
)
