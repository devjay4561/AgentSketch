package edge

import (
	"reflect"
	"strings"
	"testing"
)

func TestAgentSketchBrowserArgumentsAlwaysProtectAuthentication(t *testing.T) {
	SetAdditionalBrowserArguments(nil)
	got := MergeBrowserArguments(nil)
	want := []string{"--disable-features=AutofillAiWalletPrivatePasses"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%v != %v", got, want)
	}
}

func TestAgentSketchBrowserArgumentsMergePreservesFlags(t *testing.T) {
	SetAdditionalBrowserArguments([]string{"--remote-debugging-port=9227", "--remote-debugging-address=127.0.0.1", "--disable-features=Other,AutofillAiWalletPrivatePasses"})
	defer SetAdditionalBrowserArguments(nil)
	got := MergeBrowserArguments([]string{"--disable-features=msSmartScreenProtection", "--some-other-flag"})
	joined := strings.Join(got, " ")
	if strings.Count(joined, "--disable-features=") != 1 {
		t.Fatal(joined)
	}
	for _, want := range []string{"--disable-features=AutofillAiWalletPrivatePasses,msSmartScreenProtection,Other", "--remote-debugging-port=9227", "--remote-debugging-address=127.0.0.1", "--some-other-flag"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %s from %s", want, joined)
		}
	}
}
