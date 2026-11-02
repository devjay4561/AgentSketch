package edge

import (
	"strings"
	"sync"
)

var agentsketchArgs struct {
	sync.RWMutex
	values []string
}

// SetAdditionalBrowserArguments supplies explicit options to the loader. Wails
// v2 otherwise clears the standard environment variable before creating it.
// Call before creating a window. No environment/registry overrides are enabled.
func SetAdditionalBrowserArguments(args []string) {
	agentsketchArgs.Lock()
	defer agentsketchArgs.Unlock()
	agentsketchArgs.values = append([]string(nil), args...)
}

// MergeBrowserArguments keeps one --disable-features switch because Chromium
// may take only the last repeated switch. The authentication-protection feature
// is always disabled, independently of caller configuration.
func MergeBrowserArguments(base []string) []string {
	agentsketchArgs.RLock()
	extra := append([]string(nil), agentsketchArgs.values...)
	agentsketchArgs.RUnlock()
	args := append(append([]string(nil), base...), extra...)
	result := make([]string, 0, len(args)+1)
	features := []string{"AutofillAiWalletPrivatePasses"}
	seen := map[string]bool{features[0]: true}
	for _, arg := range args {
		if value, ok := strings.CutPrefix(arg, "--disable-features="); ok {
			for _, feature := range strings.Split(value, ",") {
				feature = strings.TrimSpace(feature)
				if feature != "" && !seen[feature] {
					seen[feature] = true
					features = append(features, feature)
				}
			}
		} else if arg != "" {
			result = append(result, arg)
		}
	}
	return append(result, "--disable-features="+strings.Join(features, ","))
}
