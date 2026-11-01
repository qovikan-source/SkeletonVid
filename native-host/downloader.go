package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var progressRgx = regexp.MustCompile(`\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*\S+\s+at\s+(\S+)\s+ETA\s+(\S+)`)

func writeCookieFile(cookies []Cookie) (*os.File, error) {
	if len(cookies) == 0 {
		return nil, nil
	}
	f, err := os.CreateTemp("", "sv_cookies_*.txt")
	if err != nil {
		return nil, err
	}
	_ = f.Chmod(0600)

	fmt.Fprintln(f, "# Netscape HTTP Cookie File")
	for _, c := range cookies {
		sub := "FALSE"
		if strings.HasPrefix(c.Domain, ".") {
			sub = "TRUE"
		}
		sec := "FALSE"
		if c.Secure {
			sec = "TRUE"
		}
		fmt.Fprintf(f, "%s\t%s\t%s\t%s\t%d\t%s\t%s\n",
			c.Domain, sub, c.Path, sec, c.ExpirationDate, c.Name, c.Value)
	}
	_ = f.Close()
	return f, nil
}

func handleDownload(msg IncomingMessage) {
	if ok, err := verifyLicense(msg.LicenseToken); !ok {
		log.Printf("[SkeletonVid:Downloader] License rejected for job %s: %v", msg.JobID, err)
		_ = sendMessage(OutgoingMessage{
			Type:   "ERROR",
			JobID:  msg.JobID,
			Status: "error",
			Error:  "License expired or invalid. Please check your subscription.",
		})
		return
	}

	homeDir, _ := os.UserHomeDir()
	downloadDir := filepath.Join(homeDir, "Downloads", "SkeletonVid")
	_ = os.MkdirAll(downloadDir, 0755)

	cookieFile, err := writeCookieFile(msg.Cookies)
	if err != nil {
		log.Printf("[SkeletonVid:Downloader] Warning: could not write cookies: %v", err)
	}
	if cookieFile != nil {
		defer os.Remove(cookieFile.Name())
	}

	outTemplate := filepath.Join(downloadDir, fmt.Sprintf("%s.%%(ext)s", msg.Title))
	format := msg.Format
	if format == "" {
		format = "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best"
	}

	args := []string{
		"--newline",
		"--no-colors",
		"--concurrent-fragments", "3",
		"--merge-output-format", "mp4",
		"-f", format,
		"-o", outTemplate,
	}

	if msg.UserAgent != "" {
		args = append(args, "--user-agent", msg.UserAgent)
	}
	if msg.PageURL != "" {
		args = append(args, "--referer", msg.PageURL)
	}
	if cookieFile != nil {
		args = append(args, "--cookies", cookieFile.Name())
	}
	args = append(args, msg.URL)

	ytDlpPath := getBinaryPath("yt-dlp")
	cmd := exec.Command(ytDlpPath, args...)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		_ = sendMessage(OutgoingMessage{Type: "ERROR", JobID: msg.JobID, Status: "error", Error: err.Error()})
		return
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		log.Printf("[SkeletonVid:Downloader] Failed to spawn %s: %v", ytDlpPath, err)
		_ = sendMessage(OutgoingMessage{Type: "ERROR", JobID: msg.JobID, Status: "error", Error: "Media engine not found"})
		return
	}

	registerProcess(msg.JobID, cmd)
	defer unregisterProcess(msg.JobID)

	scanner := bufio.NewScanner(stdoutPipe)
	for scanner.Scan() {
		line := scanner.Text()
		matches := progressRgx.FindStringSubmatch(line)
		if len(matches) == 4 {
			pct, _ := strconv.ParseFloat(matches[1], 64)
			_ = sendMessage(OutgoingMessage{
				Type:    "PROGRESS",
				JobID:   msg.JobID,
				Status:  "downloading",
				Percent: pct,
				Speed:   matches[2],
				ETA:     matches[3],
			})
		}
	}

	if err := cmd.Wait(); err != nil {
		log.Printf("[SkeletonVid:Downloader] Command ended with: %v", err)
		_ = sendMessage(OutgoingMessage{Type: "ERROR", JobID: msg.JobID, Status: "error", Error: "Download process interrupted"})
		return
	}

	_ = sendMessage(OutgoingMessage{
		Type:     "COMPLETED",
		JobID:    msg.JobID,
		Status:   "completed",
		Percent:  100.0,
		Speed:    "Done",
		ETA:      "00:00",
		Filepath: downloadDir,
	})
}
