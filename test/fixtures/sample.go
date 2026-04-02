package main

import "os"

func main() {
	_ = os.Getenv("DB_URL")
	_, _ = os.LookupEnv("API_KEY")
}
