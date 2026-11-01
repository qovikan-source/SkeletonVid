package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
)

var stdoutMu sync.Mutex

type Cookie struct {
	Domain         string `json:"domain"`
	Path           string `json:"path"`
	Secure         bool   `json:"secure"`
	ExpirationDate int64  `json:"expirationDate"`
	Name           string `json:"name"`
	Value          string `json:"value"`
}

type IncomingMessage struct {
	Type         string   `json:"type"`
	JobID        string   `json:"jobId"`
	LicenseToken string   `json:"licenseToken,omitempty"`
	URL          string   `json:"url,omitempty"`
	PageURL      string   `json:"pageUrl,omitempty"`
	Title        string   `json:"title,omitempty"`
	Format       string   `json:"format,omitempty"`
	UserAgent    string   `json:"userAgent,omitempty"`
	Cookies      []Cookie `json:"cookies,omitempty"`
}

type OutgoingMessage struct {
	Type     string  `json:"type"`
	JobID    string  `json:"jobId"`
	Status   string  `json:"status"`
	Percent  float64 `json:"percent"`
	Speed    string  `json:"speed"`
	ETA      string  `json:"eta"`
	Filepath string  `json:"filepath,omitempty"`
	Error    string  `json:"error,omitempty"`
}

type LicensePayload struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

func readMessage(r io.Reader) (*IncomingMessage, error) {
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return nil, err
	}

	if length == 0 || length > 10*1024*1024 {
		return nil, fmt.Errorf("invalid message size: %d bytes", length)
	}

	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, err
	}

	var msg IncomingMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

func sendMessage(msg OutgoingMessage) error {
	stdoutMu.Lock()
	defer stdoutMu.Unlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	length := uint32(len(data))
	if err := binary.Write(os.Stdout, binary.LittleEndian, length); err != nil {
		return err
	}
	_, err = os.Stdout.Write(data)
	return err
}
