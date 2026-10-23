// ModalConfirmar.js
import React from 'react';
import '../css/fadein.css';

const ModalConfirmar = ({ title, message, onCancel, onConfirm }) => {

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };


  return (
    <div className="fixed inset-0 bg-gray-700 bg-opacity-75 flex items-center justify-center z-20" onClick={handleOverlayClick}>
      <div className="rounded-md shadow-md fade-in-from-top">
        <div className='bg-red-500 rounded-t-md p-3'>
            <h1 className='text-center text-white text-3xl uppercase'>{title}</h1>
        </div>
        <div className='bg-white rounded-b-md p-3 px-9'>
            <p>{message}</p>
            <div className="flex justify-end mt-5 mb-2">
              <button onClick={onCancel} className="p-2 px-4 mr-5 bg-slate-200 rounded hover:bg-slate-300 hover:rounded-lg transition-all transform:200">
                Cancelar
              </button>
              <button onClick={onConfirm} className="rounded bg-red-500 text-white p-2 hover:bg-red-600 hover:rounded-lg transition-all transform:200">
                Confirmar
              </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ModalConfirmar;
