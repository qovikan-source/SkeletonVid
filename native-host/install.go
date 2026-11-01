package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func getManifestJSON(exePath string) ([]byte, error) {
	manifest := map[string]interface{}{
		"name":        HostName,
		"description": "SkeletonVid Pro Native Companion",
		"path":        exePath,
		"type":        "stdio",
		"allowed_origins": []string{
			fmt.Sprintf("chrome-extension://%s/", ExtensionID),
		},
	}
	return json.MarshalIndent(manifest, "", "  ")
}

func installHostManifest() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return err
	}

	data, err := getManifestJSON(exePath)
	if err != nil {
		return err
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	switch runtime.GOOS {
	case "darwin":
		dir := filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
		_ = os.MkdirAll(dir, 0755)
		target := filepath.Join(dir, HostName+".json")
		log.Printf("[SkeletonVid:Install] Writing manifest to %s", target)
		return os.WriteFile(target, data, 0644)

	case "linux":
		dir := filepath.Join(home, ".config", "google-chrome", "NativeMessagingHosts")
		_ = os.MkdirAll(dir, 0755)
		target := filepath.Join(dir, HostName+".json")
		log.Printf("[SkeletonVid:Install] Writing manifest to %s", target)
		return os.WriteFile(target, data, 0644)

	case "windows":
		dir := getAppDataDir()
		_ = os.MkdirAll(dir, 0755)
		manifestPath := filepath.Join(dir, HostName+".json")
		log.Printf("[SkeletonVid:Install] Writing Windows manifest to %s", manifestPath)
		if err := os.WriteFile(manifestPath, data, 0644); err != nil {
			return err
		}
		regKey := `HKCU\Software\Google\Chrome\NativeMessagingHosts\` + HostName
		log.Printf("[SkeletonVid:Install] Setting registry key: %s", regKey)
		cmd := exec.Command("reg", "add", regKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f")
		return cmd.Run()

	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
}

func uninstallHostManifest() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	switch runtime.GOOS {
	case "darwin":
		target := filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", HostName+".json")
		return os.Remove(target)
	case "linux":
		target := filepath.Join(home, ".config", "google-chrome", "NativeMessagingHosts", HostName+".json")
		return os.Remove(target)
	case "windows":
		regKey := `HKCU\Software\Google\Chrome\NativeMessagingHosts\` + HostName
		_ = exec.Command("reg", "delete", regKey, "/f").Run()
		manifestPath := filepath.Join(getAppDataDir(), HostName+".json")
		return os.Remove(manifestPath)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}
