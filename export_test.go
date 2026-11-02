package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func testRasterURL(t *testing.T, kind string) string {
	t.Helper()
	i := image.NewNRGBA(image.Rect(0, 0, 6, 4))
	i.SetNRGBA(1, 2, color.NRGBA{R: 255, A: 100})
	var b bytes.Buffer
	var err error
	if kind == "png" {
		err = png.Encode(&b, i)
	} else {
		err = jpeg.Encode(&b, i, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return "data:image/" + kind + ";base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestDecodeExportRasterAndMismatch(t *testing.T) {
	for _, kind := range []string{"png", "jpeg"} {
		source := testRasterURL(t, kind)
		got, err := decodeExport(kind, source)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := image.Decode(bytes.NewReader(got)); err != nil {
			t.Fatalf("export is invalid image: %v", err)
		}
		original, _, _ := decodeRasterURL(source, false)
		if !bytes.Equal(original, got) {
			t.Fatal("raster export changed the original bytes")
		}
	}
	if _, err := decodeExport("jpeg", testRasterURL(t, "png")); err == nil {
		t.Fatal("accepted MIME mismatch")
	}
}

func TestPDFCrossReferencesAndEmbeddedImage(t *testing.T) {
	pdf, err := decodeExport("pdf", testRasterURL(t, "png"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) || !bytes.HasSuffix(pdf, []byte("%%EOF\n")) {
		t.Fatal("invalid PDF envelope")
	}
	start := regexp.MustCompile(`startxref\n(\d+)`).FindSubmatch(pdf)
	if len(start) != 2 {
		t.Fatal("missing startxref")
	}
	xref, _ := strconv.Atoi(string(start[1]))
	if !bytes.HasPrefix(pdf[xref:], []byte("xref\n0 6\n")) {
		t.Fatal("startxref points to incorrect offset")
	}
	lines := strings.Split(string(pdf[xref:]), "\n")
	for n := 1; n <= 5; n++ {
		offset, e := strconv.Atoi(lines[n+2][:10])
		if e != nil || !bytes.HasPrefix(pdf[offset:], []byte(strconv.Itoa(n)+" 0 obj\n")) {
			t.Fatalf("bad object %d offset", n)
		}
	}
	imageHeader := regexp.MustCompile(`(?s)4 0 obj\n<<.*?/Length (\d+) >>\nstream\n`).FindIndex(pdf)
	if imageHeader == nil {
		t.Fatal("no image stream")
	}
	streamStart := imageHeader[1]
	streamEnd := bytes.Index(pdf[streamStart:], []byte("\nendstream")) + streamStart
	img, err := jpeg.Decode(bytes.NewReader(pdf[streamStart:streamEnd]))
	if err != nil || img.Bounds().Dx() != 6 || img.Bounds().Dy() != 4 {
		t.Fatalf("invalid embedded image: %v", err)
	}
	r, g, b, _ := img.At(5, 3).RGBA()
	if r < 62000 || g < 62000 || b < 62000 {
		t.Fatalf("transparent background did not flatten to white: %d %d %d", r, g, b)
	}
	if !bytes.Contains(pdf, []byte("/Count 1")) || !bytes.Contains(pdf, []byte("/MediaBox [0 0 4.500 3.000]")) {
		t.Fatal("wrong page geometry")
	}
}

func TestExportRejectsMalformedAndOversizedRaster(t *testing.T) {
	for _, input := range []string{"", "data:image/png;base64,%%%", "data:image/png;base64,SGVsbG8=", "https://example.com/image.png", "data:image/svg+xml;base64,PHN2Zy8+"} {
		if _, err := decodeExport("png", input); err == nil {
			t.Fatalf("accepted %q", input)
		}
	}
	if _, err := decodeExport("exe", testRasterURL(t, "png")); err == nil {
		t.Fatal("accepted unknown format")
	}
	// A valid PNG header announcing an oversized image is rejected before decode
	// would allocate the declared pixel buffer.
	raw, _, _ := decodeRasterURL(testRasterURL(t, "png"), false)
	binary.BigEndian.PutUint32(raw[16:20], 9000)
	binary.BigEndian.PutUint32(raw[29:33], crc32.ChecksumIEEE(raw[12:29]))
	input := "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw)
	if _, err := decodeExport("pdf", input); err == nil || !strings.Contains(err.Error(), "8192") {
		t.Fatalf("dimension guard missing: %v", err)
	}
	valid, _, _ := decodeRasterURL(testRasterURL(t, "png"), false)
	if _, err := decodeExport("png", "data:image/png;base64,"+base64.StdEncoding.EncodeToString(valid[:33])); err == nil {
		t.Fatal("accepted truncated PNG")
	}
}

func TestStaticSVGAllowsSelfContainedDrawing(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><defs><marker id="arrow"><path d="M0 0L10 5L0 10Z"/></marker></defs><rect fill="#fff" width="200" height="100"/><path d="M0 0L10 10" marker-end="url(#arrow)"/><text x="10" y="20">월간보고 &amp; 확인</text><image href="` + testRasterURL(t, "png") + `" width="6" height="4"/></svg>`
	got, err := decodeExport("svg", svg)
	if err != nil || string(got) != svg {
		t.Fatalf("valid SVG failed: %v", err)
	}
}

func TestStaticSVGRejectsActiveOrRemoteContent(t *testing.T) {
	inputs := []string{
		`<html/>`, `<svg/><svg/>`, `<svg><g></svg>`,
		`<svg><script>alert(1)</script></svg>`,
		`<svg><foreignObject><p>bad</p></foreignObject></svg>`,
		`<svg onload="alert(1)"/>`,
		`<svg><image href="https://example.com/p.png"/></svg>`,
		`<svg><use href="https://example.com/p.svg#p"/></svg>`,
		`<svg><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>`,
		`<svg><rect fill="url(https://example.com/a.svg)"/></svg>`,
		`<svg><rect style="fill:u\72l(https://example.com)"/></svg>`,
		`<svg><style>@import 'https://example.com/x.css';</style></svg>`,
		`<!DOCTYPE svg SYSTEM "https://example.com"><svg/>`,
		`<?xml-stylesheet href="https://example.com"?><svg/>`,
		`<svg xml:base="https://example.com/"/>`,
		`<svg xmlns="http://evil.example.com"/>`,
	}
	for _, input := range inputs {
		if _, err := decodeExport("svg", input); err == nil {
			t.Fatalf("accepted unsafe SVG: %s", input)
		}
	}
}
