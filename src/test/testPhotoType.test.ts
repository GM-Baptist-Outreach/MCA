import { describe, expect, it } from "vitest";
import { testPhotoContentType } from "@/lib/testPhotoType";

describe("testPhotoContentType", () => {
  it("keeps accepted browser types", () => {
    expect(testPhotoContentType({ name: "a.jpg", type: "image/jpeg" })).toBe("image/jpeg");
    expect(testPhotoContentType({ name: "a.png", type: "image/png" })).toBe("image/png");
    expect(testPhotoContentType({ name: "IMG_1.HEIC", type: "image/heic" })).toBe("image/heic");
    expect(testPhotoContentType({ name: "a.jpg", type: "image/jpg" })).toBe("image/jpeg");
  });

  it("fills in HEIC/HEIF from the extension when the browser type is empty", () => {
    expect(testPhotoContentType({ name: "IMG_0042.HEIC", type: "" })).toBe("image/heic");
    expect(testPhotoContentType({ name: "scan.heif", type: "application/octet-stream" })).toBe("image/heif");
    expect(testPhotoContentType({ name: "page.JPEG", type: "" })).toBe("image/jpeg");
  });

  it("rejects non-photos and types the bucket refuses", () => {
    expect(testPhotoContentType({ name: "test.pdf", type: "application/pdf" })).toBeNull();
    expect(testPhotoContentType({ name: "notes", type: "" })).toBeNull();
    expect(testPhotoContentType({ name: "raw.tiff", type: "image/tiff" })).toBeNull();
  });
});
