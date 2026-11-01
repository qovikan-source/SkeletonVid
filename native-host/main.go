package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
)

const AppVersion = "1.0.0"

func initLogger() {
	logDir := getAppDataDir()
	_ = os.MkdirAll(logDir, 0755)
	logFile, err := os.OpenFile(filepath.Join(logDir, "SkeletonVid.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		log.SetOutput(logFile)
	} else {
		log.SetOutput(os.Stderr)
	}
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds | log.Lshortfile)
}

func main() {
	initLogger()

	installFlag := flag.Bool("install", false, "Register Chrome Native Messaging Host & bootstrap binaries")
	uninstallFlag := flag.Bool("uninstall", false, "Unregister Chrome Native Messaging Host")
	versionFlag := flag.Bool("version", false, "Print companion version")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("SkeletonVid Native Companion v%s\n", AppVersion)
		return
	}

	if *uninstallFlag {
		if err := uninstallHostManifest(); err != nil {
			fmt.Fprintf(os.Stderr, "Uninstall failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("SkeletonVid Companion uninstalled successfully.")
		return
	}

	if *installFlag {
		_ = ensureBinaries()
		if err := installHostManifest(); err != nil {
			fmt.Fprintf(os.Stderr, "Install failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("SkeletonVid Companion successfully registered with Chrome.")
		return
	}

	log.Printf("[SkeletonVid:Host] Companion host started (v%s, ExtensionID: %s)", AppVersion, ExtensionID)
	defer terminateAllProcesses()

	for {
		msg, err := readMessage(os.Stdin)
		if err != nil {
			if err == io.EOF {
				log.Println("[SkeletonVid:Host] Stdin closed by Chrome, terminating companion")
				break
			}
			log.Printf("[SkeletonVid:Host] Stdin read error: %v", err)
			break
		}

		switch msg.Type {
		case "START_DOWNLOAD":
			log.Printf("[SkeletonVid:Host] Received START_DOWNLOAD for job %s", msg.JobID)
			go handleDownload(*msg)
		case "CANCEL_DOWNLOAD":
			log.Printf("[SkeletonVid:Host] Received CANCEL_DOWNLOAD for job %s", msg.JobID)
			cancelProcess(msg.JobID)
		default:
			log.Printf("[SkeletonVid:Host] Unrecognized message type: %s", msg.Type)
		}
	}
}
