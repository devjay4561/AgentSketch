package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"testing"
)

func TestArtifactFormats(t *testing.T) {
	for _, kind := range []string{"csv", "drawio", "html"} {
		if _, ext, err := decodeArtifact(kind, "한글 자료"); err != nil || ext != kind {
			t.Fatalf("%s: %v", kind, err)
		}
	}
	if _, _, err := decodeArtifact("html", "<script>alert(1)</script>"); err == nil {
		t.Fatal("script accepted")
	}
	if _, ext, err := decodeArtifact("html-viewer", "<svg/><script>fit()</script>"); err != nil || ext != "html" {
		t.Fatal("viewer rejected", err)
	}
	if _, _, err := decodeArtifact("html-viewer", "<script>a()</script><SCRIPT>b()</SCRIPT>"); err == nil {
		t.Fatal("second viewer script accepted")
	}
	if _, _, err := decodeArtifact("drawio", "<!DOCTYPE root>"); err == nil {
		t.Fatal("DTD accepted")
	}
	if _, _, err := decodeArtifact("exe", "binary"); err == nil {
		t.Fatal("unknown type accepted")
	}
	raw := base64.StdEncoding.EncodeToString([]byte("%PDF-1.7\n%%EOF"))
	if _, ext, err := decodeArtifact("pdf-vector", raw); err != nil || ext != "pdf" {
		t.Fatal(err)
	}
	if _, _, err := decodeArtifact("pdf-vector", base64.StdEncoding.EncodeToString([]byte("not pdf"))); err == nil {
		t.Fatal("invalid pdf accepted")
	}
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("ppt/presentation.xml")
	f.Write([]byte("<presentation/>"))
	w.Close()
	if _, _, err := decodeArtifact("pptx", base64.StdEncoding.EncodeToString(buf.Bytes())); err != nil {
		t.Fatal(err)
	}
}

func TestAttachmentArtifactLimits(t *testing.T) {
	raw := base64.StdEncoding.EncodeToString([]byte("첨부 자료"))
	data, ext, err := decodeArtifact("attachment:txt", raw)
	if err != nil || ext != "txt" || string(data) != "첨부 자료" {
		t.Fatal("text attachment", err)
	}
	if _, _, err = decodeArtifact("attachment:exe", raw); err == nil {
		t.Fatal("executable attachment accepted")
	}
	if _, _, err = decodeArtifact("attachment:pdf", raw); err == nil {
		t.Fatal("fake pdf accepted")
	}
	if _, _, err = decodeArtifact("attachment:txt", base64.StdEncoding.EncodeToString(make([]byte, (5<<20)+1))); err == nil {
		t.Fatal("oversized attachment accepted")
	}
}
