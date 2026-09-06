package main

import (
	"log"
	"net/http"
	"os"
)

var version = "dev"

func main() {
	cfg, err := LoadConfig(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	srv := NewServer(cfg)
	log.Printf("listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, srv))
}
