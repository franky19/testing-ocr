'use client';

import React, {useMemo, useRef, useState} from 'react';
import Webcam from 'react-webcam';
import Tesseract from 'tesseract.js';

interface KTPData {
  nik: string;
  nama: string;
  tempatLahir: string;
  tanggalLahir: string;
  jenisKelamin: string;
  alamat: string;
  agama: string;
  status: string;
}

const videoConstraints = {
  width: 1920,
  height: 1080,
  facingMode: 'environment',
};

const FIELD_AREAS = {
  nik: {
    x: 0.12,
    y: 0.14,
    width: 0.58,
    height: 0.1,
    threshold: 140,
  },

  nama: {
    x: 0.22,
    y: 0.24,
    width: 0.42,
    height: 0.09,
    threshold: 160,
  },

  ttl: {
    x: 0.22,
    y: 0.33,
    width: 0.45,
    height: 0.08,
    threshold: 160,
  },

  gender: {
    x: 0.22,
    y: 0.4,
    width: 0.48,
    height: 0.07,
    threshold: 160,
  },

  alamat: {
    x: 0.22,
    y: 0.47,
    width: 0.5,
    height: 0.12,
    threshold: 165,
  },

  agama: {
    x: 0.22,
    y: 0.65,
    width: 0.3,
    height: 0.06,
    threshold: 160,
  },

  status: {
    x: 0.32,
    y: 0.7,
    width: 0.36,
    height: 0.06,
    threshold: 160,
  },
};

export const IdentityVerification = () => {
  const webcamRef = useRef<Webcam | null>(null);

  const [image, setImage] = useState('');

  const [loading, setLoading] = useState(false);

  const [progress, setProgress] = useState(0);

  const [rawText, setRawText] = useState('');

  const [processedFields, setProcessedFields] = useState<
    Record<string, string>
  >({});

  const [ktpData, setKtpData] = useState<KTPData>({
    nik: '',
    nama: '',
    tempatLahir: '',
    tanggalLahir: '',
    jenisKelamin: '',
    alamat: '',
    agama: '',
    status: '',
  });

  /**
   * LOAD IMAGE
   */

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise(resolve => {
      const img = new Image();

      img.onload = () => resolve(img);

      img.src = src;
    });
  };

  /**
   * CROP FIELD
   */

  const cropField = async (
    imageSrc: string,
    config: {
      x: number;
      y: number;
      width: number;
      height: number;
      threshold?: number;
      scale?: number;
    },
  ): Promise<string> => {
    const img = await loadImage(imageSrc);

    const canvas = document.createElement('canvas');

    const ctx = canvas.getContext('2d');

    if (!ctx) return imageSrc;

    const scale = config.scale || 4;

    const cropX = img.width * config.x;

    const cropY = img.height * config.y;

    const cropW = img.width * config.width;

    const cropH = img.height * config.height;

    canvas.width = cropW * scale;

    canvas.height = cropH * scale;

    ctx.imageSmoothingEnabled = true;

    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
      img,
      cropX,
      cropY,
      cropW,
      cropH,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    /**
     * preprocess
     */

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const data = imageData.data;

    const threshold = config.threshold || 150;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];

      const g = data[i + 1];

      const b = data[i + 2];

      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      /**
       * stronger contrast
       */

      gray = gray * 1.25;

      /**
       * threshold
       */

      gray = gray > threshold ? 255 : 0;

      data[i] = gray;

      data[i + 1] = gray;

      data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
  };

  /**
   * OCR HELPER
   */

  const workerTesseract = async (lang = 'ind') => {
    const worker = await Tesseract.createWorker(lang);
    return worker;
  };

  const recognizeText = async (
    image: string,
    lang = 'ind',
    whitelist = '',
    psm = '6',
  ) => {
    const worker = await workerTesseract(lang);

    await worker.load();
    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tessedit_pageseg_mode: psm as any,
    });

    const result = await worker.recognize(image);

    return result.data.text?.trim() || '';
  };

  /**
   * CLEAN TEXT
   */

  const cleanText = (text: string) => {
    return text
      .replace(/[—=~`]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[|]/g, 'I')
      .trim();
  };

  /**
   * MAIN OCR
   */

  const runOCR = async (imageSrc: string) => {
    try {
      setLoading(true);

      setProgress(0);

      /**
       * crop all fields
       */

      const nikCrop = await cropField(imageSrc, FIELD_AREAS.nik);

      const namaCrop = await cropField(imageSrc, FIELD_AREAS.nama);

      const ttlCrop = await cropField(imageSrc, FIELD_AREAS.ttl);

      const genderCrop = await cropField(imageSrc, FIELD_AREAS.gender);

      const alamatCrop = await cropField(imageSrc, FIELD_AREAS.alamat);

      const agamaCrop = await cropField(imageSrc, FIELD_AREAS.agama);

      const statusCrop = await cropField(imageSrc, FIELD_AREAS.status);

      /**
       * show processed field
       */

      setProcessedFields({
        nik: nikCrop,
        nama: namaCrop,
        ttl: ttlCrop,
        gender: genderCrop,
        alamat: alamatCrop,
        agama: agamaCrop,
        status: statusCrop,
      });

      /**
       * OCR per field
       */

      const [
        nikText,
        namaText,
        ttlText,
        genderText,
        alamatText,
        agamaText,
        statusText,
      ] = await Promise.all([
        recognizeText(nikCrop, 'eng', '0123456789', '7'),

        recognizeText(
          namaCrop,
          'ind',
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',
          '7',
        ),

        recognizeText(
          ttlCrop,
          'ind',
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,./- ',
          '7',
        ),

        recognizeText(
          genderCrop,
          'ind',
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- ',
          '7',
        ),

        recognizeText(
          alamatCrop,
          'ind',
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./- ',
          '6',
        ),

        recognizeText(
          agamaCrop,
          'ind',
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',
          '7',
        ),

        recognizeText(
          statusCrop,
          'ind',
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',
          '7',
        ),
      ]);

      /**
       * CLEAN RESULT
       */

      const nik = nikText.match(/\d{16}/)?.[0] || '';

      const nama = cleanText(namaText)
        .replace(/[^A-Za-z\s]/g, '')
        .toUpperCase();

      /**
       * TTL
       */

      let tempatLahir = '';

      let tanggalLahir = '';

      const ttlMatch = ttlText.match(
        /([A-Z\s]+),?\s*(\d{2}[-/]\d{2}[-/]\d{4})/i,
      );

      if (ttlMatch) {
        tempatLahir = cleanText(ttlMatch[1]);

        tanggalLahir = cleanText(ttlMatch[2]);
      }

      /**
       * gender
       */

      let jenisKelamin = '';

      if (/PEREMPUAN/i.test(genderText)) {
        jenisKelamin = 'PEREMPUAN';
      } else if (/LAKI/i.test(genderText)) {
        jenisKelamin = 'LAKI-LAKI';
      }

      /**
       * agama
       */

      const agama =
        agamaText.match(/ISLAM|KRISTEN|KATOLIK|HINDU|BUDDHA|KHONGHUCU/i)?.[0] ||
        '';

      /**
       * status
       */

      let status = '';

      if (/BELUM/i.test(statusText)) {
        status = 'BELUM KAWIN';
      } else if (/KAWIN/i.test(statusText)) {
        status = 'KAWIN';
      }

      setKtpData({
        nik,

        nama,

        tempatLahir,

        tanggalLahir,

        jenisKelamin,

        alamat: cleanText(alamatText),

        agama,

        status,
      });

      /**
       * RAW TEXT
       */

      setRawText(`
=== NIK ===
${nikText}

=== NAMA ===
${namaText}

=== TTL ===
${ttlText}

=== GENDER ===
${genderText}

=== ALAMAT ===
${alamatText}

=== AGAMA ===
${agamaText}

=== STATUS ===
${statusText}
`);
    } catch (_err) {
      // console.error(err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * CAMERA CAPTURE
   */

  const capture = async () => {
    const screenshot = webcamRef.current?.getScreenshot();

    if (!screenshot) return;

    setImage(screenshot);

    await runOCR(screenshot);
  };

  /**
   * UPLOAD IMAGE
   */

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('File harus image');

      return;
    }

    const reader = new FileReader();

    reader.onload = async () => {
      const result = reader.result as string;

      setImage(result);

      await runOCR(result);
    };

    reader.readAsDataURL(file);
  };

  const progressWidth = useMemo(() => {
    return `${progress}%`;
  }, [progress]);

  return (
    <div
      style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: 20,
        fontFamily: 'Arial',
      }}>
      <h1>OCR KTP Indonesia - OCR Per Field</h1>

      <div
        style={{
          display: 'flex',
          gap: 20,
          flexWrap: 'wrap',
        }}>
        <div>
          <h3>Camera</h3>

          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/png"
            videoConstraints={videoConstraints}
            style={{
              width: 500,
              borderRadius: 12,
              border: '1px solid #ddd',
            }}
          />

          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 10,
            }}>
            <button onClick={capture}>Capture KTP</button>

            <input type="file" accept="image/*" onChange={handleUpload} />
          </div>
        </div>

        <div>
          <h3>Original</h3>

          {image && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}{' '}
              <img
                src={image}
                alt="Original"
                style={{
                  width: 500,
                  borderRadius: 12,
                  border: '1px solid #ddd',
                }}
              />
            </>
          )}
        </div>
      </div>

      {loading && (
        <div
          style={{
            marginTop: 30,
          }}>
          <h3>OCR Processing... {progress}%</h3>

          <div
            style={{
              width: '100%',
              height: 12,
              background: '#eee',
              borderRadius: 999,
              overflow: 'hidden',
            }}>
            <div
              style={{
                width: progressWidth,
                height: '100%',
                background: '#111',
              }}
            />
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 30,
        }}>
        <h2>Processed OCR Fields</h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 20,
          }}>
          {Object.entries(processedFields).map(([key, value]) => (
            <div key={key}>
              <h4>{key.toUpperCase()}</h4>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt={key}
                style={{
                  width: '100%',
                  border: '1px solid #ddd',
                  borderRadius: 12,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 30,
          padding: 20,
          border: '1px solid #ddd',
          borderRadius: 12,
        }}>
        <h2>Hasil OCR</h2>

        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
          }}>
          <tbody>
            <tr>
              <td>NIK</td>
              <td>{ktpData.nik}</td>
            </tr>

            <tr>
              <td>Nama</td>
              <td>{ktpData.nama}</td>
            </tr>

            <tr>
              <td>Tempat Lahir</td>
              <td>{ktpData.tempatLahir}</td>
            </tr>

            <tr>
              <td>Tanggal Lahir</td>
              <td>{ktpData.tanggalLahir}</td>
            </tr>

            <tr>
              <td>Jenis Kelamin</td>
              <td>{ktpData.jenisKelamin}</td>
            </tr>

            <tr>
              <td>Alamat</td>
              <td>{ktpData.alamat}</td>
            </tr>

            <tr>
              <td>Agama</td>
              <td>{ktpData.agama}</td>
            </tr>

            <tr>
              <td>Status</td>
              <td>{ktpData.status}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 30,
        }}>
        <h2>Raw OCR Text</h2>

        <pre
          style={{
            background: '#f5f5f5',
            padding: 20,
            borderRadius: 12,
            whiteSpace: 'pre-wrap',
            fontSize: 14,
          }}>
          {rawText}
        </pre>
      </div>
    </div>
  );
};
