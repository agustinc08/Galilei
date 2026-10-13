// AgregarModal.js
import React, { useState, useEffect, useRef } from 'react';
import '../css/fadein.css';

const AgregarModal = ({ selectedItem, onSave, onClose }) => {
  const [editedData, setEditedData] = useState(selectedItem || {});
  const modalRef = useRef();

  useEffect(() => {
    // Actualiza los datos editados cuando cambia el elemento seleccionado
    setEditedData(selectedItem || {});
  }, [selectedItem]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setEditedData((prevData) => ({ ...prevData, [name]: value }));
  };

  const handleSave = () => {
    // Lógica para guardar los cambios
    if (onSave) {
      onSave(editedData);
    }
    onClose(); // Cierra el modal después de guardar
  };

  const handleClickOutside = (e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) {
      onClose();
    }
  };

  useEffect(() => {
    // Agregar un listener para cerrar el modal al hacer clic fuera de él
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      // Limpiar el listener al desmontar el componente
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-gray-700 bg-opacity-75 flex items-center justify-center fade-in-from-top">
      <div ref={modalRef} className="bg-white rounded-md shadow-md w-100" onClick={(e) => e.stopPropagation()}>
        <div className='bg-blue-500 rounded-t-md mb-2 p-3 shadow-md'>
            <h1 className='text-center text-white text-3xl'>Agregar Documento</h1>
        </div>
        <div className='p-3'>
        <div className="flex mb-2">
            <label className="w-1/3 pr-2">
              Número:
              <input
                type="text"
                name="numero"
                value={editedData.numero || ''}
                onChange={handleInputChange}
                className="w-full border p-2 rounded"
              />
            </label>

            <label className="w-1/3 pr-2">
              Fecha:
              <input
                type="date"
                name="fecha"
                value={editedData.fecha || ''}
                onChange={handleInputChange}
                className="w-full border p-2 rounded"
              />
            </label>

            <label className="w-1/3">
              Tipo:
              <select
                name="tipo"
                value={editedData.tipo || ''}
                onChange={handleInputChange}
                className="w-full border p-2 rounded"
              >
                {/* Aquí debes agregar las opciones del select */}
                <option value="Tipo1">Tipo 1</option>
                <option value="Tipo2">Tipo 2</option>
                {/* Agrega más opciones según sea necesario */}
              </select>
            </label>
          </div>

          <label className="block mb-2">
            Voces:
            <textarea
              name="voces"
              value={editedData.voces || ''}
              onChange={handleInputChange}
              className="w-full border p-2 h-40"
            />
          </label>

        {/*
          <label className="block mb-2">
            PDF (seleccionar archivo):
            <input
              type="file"
              name="pdf"
              onChange={handleInputChange}
              className="w-full border p-2 border-none"
            />
          </label>
        */}

          <div className="flex justify-end mt-5">
            <button onClick={onClose} className="rounded bg-gray-400 text-white p-2 mr-2">
              Cancelar
            </button>
            <button onClick={handleSave} className="rounded bg-blue-500 text-white p-2">
              Guardar Cambios
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgregarModal;
