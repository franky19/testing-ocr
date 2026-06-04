'use client';

import React, {useRef, useState} from 'react';
import {LocalOcrResult} from './types';
import {useLocalDocumentOcr} from './useLocalDocumentOcr';

type Props = {
  workerVersion: string;
  workerBasePath?: string;
  debug?: boolean;
  onApply: (result: LocalOcrResult) => void;
};

export const LocalDocumentOcrUploader = ({
  workerVersion,
  workerBasePath,
  debug,
  onApply,
}: Props) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const {running, error, stage, result, run, retry, cancel} =
    useLocalDocumentOcr({
      workerVersion,
      workerBasePath,
      debug,
    });

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await run(file);
    event.target.value = '';
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    await run(file);
  };

  return (
    <div style={{marginTop: 12}}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic"
        style={{display: 'none'}}
        onChange={onFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{display: 'none'}}
        onChange={onFileChange}
      />

      <div
        onDragOver={event => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragActive ? '#2563EB' : '#94A3B8'}`,
          borderRadius: 14,
          padding: 12,
          background: dragActive ? '#EFF6FF' : '#F8FAFC',
        }}>
        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Upload Gallery
          </button>
          <button type="button" onClick={() => cameraInputRef.current?.click()}>
            Camera Capture
          </button>
          <button type="button" onClick={retry} disabled={running}>
            Retry OCR
          </button>
          <button type="button" onClick={cancel} disabled={!running}>
            Cancel OCR
          </button>
        </div>

        <p
          style={{
            marginTop: 8,
            marginBottom: 0,
            fontSize: 12,
            color: '#475569',
          }}>
          Drag and drop KTP/KK di area ini. OCR diproses full local di browser.
        </p>
      </div>

      {(running || stage.progress > 0) && (
        <div style={{marginTop: 8}}>
          <p style={{marginBottom: 6}}>
            {stage.stage} - {stage.progress}%
          </p>
          <div
            style={{
              width: '100%',
              height: 10,
              borderRadius: 999,
              background: '#E2E8F0',
              overflow: 'hidden',
            }}>
            <div
              style={{
                width: `${stage.progress}%`,
                height: '100%',
                background: '#1D4ED8',
                transition: 'width .2s linear',
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div style={{marginTop: 8, color: '#B91C1C', fontSize: 13}}>
          {error}
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: '1px solid #CBD5E1',
            borderRadius: 12,
          }}>
          <p style={{margin: 0}}>
            Confidence Engine:{' '}
            <strong>{result.confidenceEngine.finalScore.toFixed(1)}%</strong>
          </p>
          <p style={{margin: '6px 0 0'}}>NIK: {result.fields.nik || '-'}</p>
          <p style={{margin: '6px 0 0'}}>Nama: {result.fields.name || '-'}</p>
          <p style={{margin: '6px 0 0'}}>
            Alamat: {result.fields.address || '-'}
          </p>
          <button
            type="button"
            style={{marginTop: 10}}
            onClick={() => onApply(result)}>
            Apply OCR Result
          </button>
        </div>
      )}
    </div>
  );
};
