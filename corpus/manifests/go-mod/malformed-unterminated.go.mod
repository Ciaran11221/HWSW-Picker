module example.invalid/team/broken

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/missing/version
	github.com/bad/version notaversion
