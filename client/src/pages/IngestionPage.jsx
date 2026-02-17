import React, { useState, useEffect, useRef } from 'react';

const IngestionPage = () => {
    const [status, setStatus] = useState('idle'); // idle, ingesting, success, error
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState([]);
    const [limit, setLimit] = useState(100);
    const [processAll, setProcessAll] = useState(false);
    const [file, setFile] = useState(null);
    const [previewData, setPreviewData] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const logContainerRef = useRef(null);

    // Auto-scroll logs
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            setFile(selectedFile);
            parseFileForPreview(selectedFile);
        }
    };

    const parseFileForPreview = (file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target.result;
            const lines = text.split('\n').filter(line => line.trim() !== '');
            try {
                const parsed = lines.map((line, index) => {
                    try {
                        return { id: index, ...JSON.parse(line) };
                    } catch (e) {
                        return { id: index, error: 'Invalid JSON' };
                    }
                });
                setPreviewData(parsed);
                setCurrentPage(1);
            } catch (err) {
                console.error("Error parsing JSONL:", err);
                addLog(`Error parsing file for preview: ${err.message}`);
            }
        };
        // Read only first 50KB for preview to avoid hanging on large files
        // Let's read everything for now, assuming reasonable size.
        reader.readAsText(file);
    };

    const handleIngest = async () => {
        if (!file) {
            alert("Please select a file first.");
            return;
        }

        setStatus('ingesting');
        setProgress(0);
        setLogs([]);
        addLog('Uploading file and starting ingestion...');

        const formData = new FormData();
        formData.append('file', file);
        // If limit is -1 or similar, backend handles it? 
        // Or we pass a flag. Let's pass limit only if not "process all"
        // Actually, let's stick to the limit param. 
        // If "Process All" is checked, we can pass a very large number or a specific flag.
        // Let's use a large number for safety or 0 if backend supports it.
        // Backend `ingest.py` usually takes limit. 0 might mean all?
        // Let's check logic: `ingest.py` uses `args.limit`.
        // We will pass 0 for all.
        const effectiveLimit = processAll ? 0 : limit;
        formData.append('limit', effectiveLimit);

        try {
            const response = await fetch('/api/admin/ingest', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || response.statusText);
            }

            const data = await response.json();

            if (data.status === 'error') {
                throw new Error(data.message + (data.stderr ? `: ${data.stderr}` : ''));
            }

            setStatus('success');
            setProgress(100);
            addLog('Ingestion complete!');
            addLog(data.stdout || data.message);

        } catch (err) {
            console.error(err);
            setStatus('error');
            addLog(`Error: ${err.message}`);
        }
    };

    const addLog = (msg) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    // Pagination Logic
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = previewData.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(previewData.length / itemsPerPage);

    const paginate = (pageNumber) => setCurrentPage(pageNumber);

    return (
        <div className="ingestion-page">
            <header className="text-center mb-4">
                <h1 className="profile-title">Resume Ingestion</h1>
                <p className="profile-subtitle">Upload and process resumes to build your search index</p>
            </header>

            <div className="ingestion-card">
                <div
                    className={`upload-zone ${file ? 'active' : ''}`}
                    onClick={() => document.getElementById('file-upload').click()}
                >
                    <input
                        id="file-upload"
                        type="file"
                        accept=".jsonl,.json"
                        onChange={handleFileChange}
                        hidden
                    />
                    <div className="upload-icon">
                        {file ? 'qc_file' : 'cloud_upload'}
                        {/* Note: Ensure you have Material Symbols or similar, otherwise use text/svg */}
                        {!file && <span style={{ fontSize: '3rem' }}>📂</span>}
                        {file && <span style={{ fontSize: '3rem' }}>wc_file</span>}
                    </div>
                    {file ? (
                        <div className="text-center">
                            <p className="upload-text" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                                {file.name}
                            </p>
                            <p className="upload-subtext">{(file.size / 1024).toFixed(1)} KB</p>
                            <p className="text-sm text-blue-400 mt-2">Click to change file</p>
                        </div>
                    ) : (
                        <div className="text-center">
                            <p className="upload-text">Click to browse or drag file here</p>
                            <p className="upload-subtext">Supports .jsonl and .json files</p>
                        </div>
                    )}
                </div>

                <div className="ingestion-controls">
                    {/* Toggle Switch */}
                    <label className="toggle-control">
                        <input
                            type="checkbox"
                            className="toggle-checkbox"
                            checked={processAll}
                            onChange={(e) => setProcessAll(e.target.checked)}
                            hidden
                        />
                        <div className="toggle-switch"></div>
                        <span className="toggle-label">Process All Resumes</span>
                    </label>

                    {/* Limit Input */}
                    {!processAll && (
                        <div className="limit-input-group">
                            <span className="text-sm text-gray-400">Limit:</span>
                            <input
                                type="number"
                                value={limit}
                                onChange={(e) => setLimit(parseInt(e.target.value) || 0)}
                                className="limit-input"
                                min="1"
                            />
                        </div>
                    )}

                    <button
                        onClick={handleIngest}
                        disabled={status === 'ingesting' || !file}
                        className="action-btn"
                    >
                        {status === 'ingesting' ? 'Ingesting...' : 'Start Ingestion'}
                    </button>
                </div>

                {/* Progress Bar */}
                {status === 'ingesting' && (
                    <div className="progress-container">
                        <div className="progress-bar-bg">
                            <div
                                className="progress-bar-fill"
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                        <div className="progress-text">
                            <span>Processing...</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Logs Console */}
            <div className="ingestion-card" style={{ padding: '0', overflow: 'hidden' }}>
                <div className="p-4 border-b border-gray-800 bg-gray-900">
                    <h3 className="text-sm font-mono text-gray-400">Ingestion Logs</h3>
                </div>
                <div ref={logContainerRef} className="logs-console" style={{ marginTop: 0, border: 'none', borderRadius: 0 }}>
                    {logs.length === 0 && <span className="text-gray-600 italic">Waiting for ingestion to start...</span>}
                    {logs.map((log, idx) => (
                        <div key={idx} className="log-entry">{log}</div>
                    ))}
                </div>
            </div>

            {/* Preview Table */}
            {previewData.length > 0 && (
                <div className="ingestion-card">
                    <h3 className="section-title">
                        <span>data_object</span>
                        File Preview ({previewData.length} records)
                    </h3>
                    <div className="data-table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Name</th>
                                    <th>Email</th>
                                    <th>Summary Snippet</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentItems.map((item) => (
                                    <tr key={item.id}>
                                        <td className="text-muted">{item.id + 1}</td>
                                        <td style={{ fontWeight: 500 }}>{item.personal_info?.name || 'N/A'}</td>
                                        <td className="text-muted">{item.personal_info?.email || 'N/A'}</td>
                                        <td className="text-muted" style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {item.personal_info?.summary || JSON.stringify(item).substring(0, 50)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination */}
                    <div className="table-pagination">
                        <button
                            onClick={() => paginate(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="page-btn"
                        >
                            Previous
                        </button>
                        <span className="text-sm text-gray-400">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            onClick={() => paginate(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            className="page-btn"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default IngestionPage;
