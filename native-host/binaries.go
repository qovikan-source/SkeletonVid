package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

func getAppDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}

	switch runtime.GOOS {
	case "windows":
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData != "" {
			return filepath.Join(localAppData, "SkeletonVid")
		}
		return filepath.Join(home, "AppData", "Local", "SkeletonVid")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "SkeletonVid")
	default:
		return filepath.Join(home, ".local", "share", "SkeletonVid")
	}
}

func getBinaryPath(name string) string {
	binName := name
	if runtime.GOOS == "windows" {
		binName += ".exe"
	}

	appDataBin := filepath.Join(getAppDataDir(), "bin", binName)
	if _, err := os.Stat(appDataBin); err == nil {
		return appDataBin
	}

	// Fallback to system PATH
	if path, err := exec.LookPath(name); err == nil {
		return path
	}

	return appDataBin
}

func getYtDlpDownloadURL() string {
	switch runtime.GOOS {
	case "windows":
		return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
	case "darwin":
		return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
	default:
		return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
	}
}

func downloadFile(url, destPath string) error {
	log.Printf("[SkeletonVid:Binary] Downloading %s to %s...", url, destPath)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad HTTP status: %s", resp.Status)
	}

	tmpFile := destPath + ".tmp"
	out, err := os.OpenFile(tmpFile, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}

	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		_ = os.Remove(tmpFile)
		return err
	}
	out.Close()

	return os.Rename(tmpFile, destPath)
}

func ensureBinaries() error {
	binDir := filepath.Join(getAppDataDir(), "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return err
	}

	ytDlpPath := getBinaryPath("yt-dlp")
	if _, err := os.Stat(ytDlpPath); err != nil {
		dest := filepath.Join(binDir, "yt-dlp")
		if runtime.GOOS == "windows" {
			dest += ".exe"
		}
		if err := downloadFile(getYtDlpDownloadURL(), dest); err != nil {
			log.Printf("[SkeletonVid:Binary] Note: yt-dlp download failed (%v), assuming system PATH", err)
		} else {
			_ = os.Chmod(dest, 0755)
			log.Printf("[SkeletonVid:Binary] yt-dlp verified at %s", dest)
		}
	}
	return nil
}
