package main

import (
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
)

const exportMaxInput = 80 << 20
const exportMaxPixels = 32_000_000
const exportMaxDimension = 8192

// decodeExport only accepts self-contained files. It never follows image or font URLs.
func decodeExport(kind string, data string) ([]byte, error) {
	if len(data) == 0 || len(data) > exportMaxInput {
		return nil, errors.New("내보낼 자료가 비어 있거나 80MB를 초과합니다")
	}
	kind = strings.ToLower(kind)
	if kind == "svg" {
		if err := validateStaticSVG(data); err != nil {
			return nil, err
		}
		return []byte(data), nil
	}
	if kind != "png" && kind != "jpg" && kind != "jpeg" && kind != "pdf" {
		return nil, errors.New("지원하지 않는 내보내기 형식입니다")
	}
	raw, mime, err := decodeRasterURL(data, false)
	if err != nil {
		return nil, err
	}
	if (kind == "png" && mime != "image/png") || ((kind == "jpg" || kind == "jpeg") && mime != "image/jpeg") {
		return nil, errors.New("파일 형식과 이미지 자료가 일치하지 않습니다")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "png" && format != "jpeg") {
		return nil, errors.New("이미지를 읽을 수 없습니다")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > exportMaxDimension || config.Height > exportMaxDimension || int64(config.Width)*int64(config.Height) > exportMaxPixels {
		return nil, errors.New("내보내기 이미지는 한 변 8192픽셀, 총 3200만 픽셀 이하여야 합니다")
	}
	decoded, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("이미지 자료가 손상되었습니다")
	}
	if kind != "pdf" {
		return raw, nil
	}
	return imagePDF(decoded)
}

func decodeRasterURL(data string, allowOtherRaster bool) ([]byte, string, error) {
	header, encoded, ok := strings.Cut(data, ",")
	if !ok || len(encoded) == 0 || len(data) > exportMaxInput {
		return nil, "", errors.New("올바른 이미지 자료가 아닙니다")
	}
	var mime string
	switch header {
	case "data:image/png;base64":
		mime = "image/png"
	case "data:image/jpeg;base64":
		mime = "image/jpeg"
	case "data:image/webp;base64":
		if allowOtherRaster {
			mime = "image/webp"
		}
	case "data:image/gif;base64":
		if allowOtherRaster {
			mime = "image/gif"
		}
	}
	if mime == "" {
		return nil, "", errors.New("포함할 수 없는 이미지 형식입니다")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) == 0 {
		return nil, "", errors.New("이미지의 인코딩이 올바르지 않습니다")
	}
	validSignature := false
	switch mime {
	case "image/png":
		validSignature = bytes.HasPrefix(raw, []byte{137, 80, 78, 71, 13, 10, 26, 10})
	case "image/jpeg":
		validSignature = len(raw) >= 3 && raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff
	case "image/webp":
		validSignature = len(raw) >= 12 && string(raw[:4]) == "RIFF" && string(raw[8:12]) == "WEBP"
	case "image/gif":
		validSignature = len(raw) >= 6 && (string(raw[:6]) == "GIF87a" || string(raw[:6]) == "GIF89a")
	}
	if !validSignature {
		return nil, "", errors.New("이미지 형식과 내용이 일치하지 않습니다")
	}
	return raw, mime, nil
}

// PDF exports deliberately contain one flattened image: Korean glyphs and
// pasted screenshots retain exactly the appearance of the editor without a
// platform font dependency. SVG remains the editable vector export option.
func imagePDF(source image.Image) ([]byte, error) {
	b := source.Bounds()
	flat := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), source, b.Min, draw.Over)
	var raster bytes.Buffer
	if err := jpeg.Encode(&raster, flat, &jpeg.Options{Quality: 94}); err != nil {
		return nil, fmt.Errorf("PDF 이미지 변환에 실패했습니다: %w", err)
	}
	w, h := float64(b.Dx())*.75, float64(b.Dy())*.75
	if scale := math.Min(1, 14400/math.Max(w, h)); scale < 1 {
		w *= scale
		h *= scale
	}
	content := []byte(fmt.Sprintf("q\n%.3f 0 0 %.3f 0 0 cm\n/Im0 Do\nQ\n", w, h))
	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
	offsets := make([]int, 6)
	object := func(n int, body string) {
		offsets[n] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", n, body)
	}
	object(1, "<< /Type /Catalog /Pages 2 0 R >>")
	object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	object(3, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.3f %.3f] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>", w, h))
	offsets[4] = out.Len()
	fmt.Fprintf(&out, "4 0 obj\n<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n", b.Dx(), b.Dy(), raster.Len())
	out.Write(raster.Bytes())
	out.WriteString("\nendstream\nendobj\n")
	offsets[5] = out.Len()
	fmt.Fprintf(&out, "5 0 obj\n<< /Length %d >>\nstream\n", len(content))
	out.Write(content)
	out.WriteString("endstream\nendobj\n")
	xref := out.Len()
	out.WriteString("xref\n0 6\n0000000000 65535 f \n")
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xref)
	return out.Bytes(), nil
}

var svgURL = regexp.MustCompile(`(?i)url\s*\(\s*['"]?(#[A-Za-z_][A-Za-z0-9_.:-]*)['"]?\s*\)`)
var svgAnyURL = regexp.MustCompile(`(?i)url\s*\(`)

func validateStaticSVG(data string) error {
	allowed := map[string]bool{
		"svg": true, "g": true, "defs": true, "marker": true, "path": true,
		"rect": true, "circle": true, "ellipse": true, "line": true,
		"polyline": true, "polygon": true, "text": true, "tspan": true,
		"image": true, "title": true, "desc": true, "clipPath": true,
		"linearGradient": true, "radialGradient": true, "stop": true,
		"pattern": true, "mask": true, "use": true,
	}
	d := xml.NewDecoder(strings.NewReader(data))
	depth, roots, tokens := 0, 0, 0
	for {
		token, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.New("SVG 문서가 올바르지 않습니다")
		}
		tokens++
		if tokens > 1_000_000 {
			return errors.New("SVG에 요소가 너무 많습니다")
		}
		switch t := token.(type) {
		case xml.StartElement:
			if depth == 0 {
				roots++
				if roots != 1 || t.Name.Local != "svg" {
					return errors.New("SVG 루트 요소가 필요합니다")
				}
			}
			depth++
			if depth > 128 || !allowed[t.Name.Local] || (t.Name.Space != "" && t.Name.Space != "http://www.w3.org/2000/svg") {
				return errors.New("SVG에 지원하지 않는 요소가 있습니다")
			}
			for _, a := range t.Attr {
				name, value := strings.ToLower(a.Name.Local), strings.TrimSpace(a.Value)
				lower := strings.ToLower(value)
				if strings.HasPrefix(name, "on") || name == "base" || name == "src" || strings.Contains(lower, "javascript:") || strings.ContainsAny(value, "\\@") {
					return errors.New("SVG에는 실행 코드나 외부 자료를 포함할 수 없습니다")
				}
				if name == "href" {
					if strings.HasPrefix(value, "#") && len(value) > 1 {
						continue
					}
					if t.Name.Local != "image" {
						return errors.New("SVG 외부 연결은 지원하지 않습니다")
					}
					if _, _, err := decodeRasterURL(value, true); err != nil {
						return err
					}
					continue
				}
				withoutLocalURLs := svgURL.ReplaceAllString(lower, "")
				if svgAnyURL.MatchString(withoutLocalURLs) || strings.Contains(lower, "expression(") || strings.Contains(lower, "image-set(") {
					return errors.New("SVG 외부 자료 연결은 지원하지 않습니다")
				}
				if name == "width" || name == "height" {
					if n, e := strconv.ParseFloat(value, 64); e == nil && (math.IsNaN(n) || math.IsInf(n, 0) || n < 0) {
						return errors.New("SVG 크기가 올바르지 않습니다")
					}
				}
			}
		case xml.EndElement:
			depth--
		case xml.ProcInst:
			if t.Target != "xml" || roots != 0 {
				return errors.New("SVG 처리 명령은 지원하지 않습니다")
			}
		case xml.Directive:
			return errors.New("SVG 외부 문서 정의는 지원하지 않습니다")
		case xml.CharData:
			if depth == 0 && len(bytes.TrimSpace(t)) > 0 {
				return errors.New("SVG 밖에 자료가 있습니다")
			}
		}
	}
	if roots != 1 || depth != 0 {
		return errors.New("SVG 문서가 비어 있거나 올바르지 않습니다")
	}
	return nil
}
