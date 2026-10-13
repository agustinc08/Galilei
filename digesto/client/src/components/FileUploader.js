// FileUploader.js
import React, { useState } from 'react';

const FileUploader = ({ onFileUpload }) => {
  const [selectedFile, setSelectedFile] = useState(null);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    setSelectedFile(file);
  };

  const handleUpload = () => {
    if (selectedFile) {
      const formData = new FormData();
      formData.append('pdf', selectedFile);

      // Puedes agregar otras claves y valores según las necesidades
      formData.append('numero', '1');
      formData.append('tipo', '1');

      // Simulamos la llamada al backend
      simulateBackendCall(formData);
    }
  };

  const simulateBackendCall = (formData) => {
    // Aquí deberías realizar la llamada al backend
    // Reemplaza la siguiente línea con la llamada real
    fetch('https://cncivil04.pjn.gov.ar/api/carga-de-datos/guardar-datos', {
      method: 'POST',
      body: formData,
    })
      .then((response) => response.json())
      .then((data) => {
        // Llama a la función proporcionada por las propiedades
        // para manejar la respuesta del backend en tu componente principal
        if (onFileUpload) {
          onFileUpload(data);
        }
      })
      .catch((error) => {
        console.error('Error al subir el archivo:', error);
      });
  };

  return (
    <div>
      <input type="file" onChange={handleFileChange} />
      <button onClick={handleUpload}></button>
    </div>
  );
};

export default FileUploader;
