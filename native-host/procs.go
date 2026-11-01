package main

import (
	"log"
	"os/exec"
	"sync"
)

var (
	procsMu     sync.Mutex
	activeProcs = make(map[string]*exec.Cmd)
)

func registerProcess(jobID string, cmd *exec.Cmd) {
	procsMu.Lock()
	defer procsMu.Unlock()
	activeProcs[jobID] = cmd
	pid := 0
	if cmd != nil && cmd.Process != nil {
		pid = cmd.Process.Pid
	}
	log.Printf("[SkeletonVid:Proc] Registered process for job %s (PID %d)", jobID, pid)
}

func unregisterProcess(jobID string) {
	procsMu.Lock()
	defer procsMu.Unlock()
	delete(activeProcs, jobID)
	log.Printf("[SkeletonVid:Proc] Unregistered job %s", jobID)
}

func cancelProcess(jobID string) bool {
	procsMu.Lock()
	cmd, exists := activeProcs[jobID]
	procsMu.Unlock()

	if !exists || cmd == nil || cmd.Process == nil {
		log.Printf("[SkeletonVid:Proc] Cancel requested for unknown or terminated job %s", jobID)
		return false
	}

	log.Printf("[SkeletonVid:Proc] Terminating process for job %s (PID %d)", jobID, cmd.Process.Pid)
	if err := cmd.Process.Kill(); err != nil {
		log.Printf("[SkeletonVid:Proc] Error killing process: %v", err)
	}
	return true
}

func terminateAllProcesses() {
	procsMu.Lock()
	defer procsMu.Unlock()

	for jobID, cmd := range activeProcs {
		if cmd != nil && cmd.Process != nil {
			log.Printf("[SkeletonVid:Proc] Cleanup terminating job %s (PID %d)", jobID, cmd.Process.Pid)
			_ = cmd.Process.Kill()
		}
	}
	activeProcs = make(map[string]*exec.Cmd)
}
