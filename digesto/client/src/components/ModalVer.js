import React from 'react';
import { X , AlertCircle} from 'react-feather';

const ModalVer = ({ show, onHide, documento, handleModalVer }) => {
  const openInternalUrlInNewTab = (internalUrl) => {
    window.open(internalUrl, '_blank');
  };

  const handleParentDocumentClick = (parentDocument) => {
    // Llama a la función handleModalVer pasando el documento padre
    handleModalVer(parentDocument);
  };

  return (
    <div className={`fixed inset-0 flex items-center justify-center z-50 ${show ? 'block' : 'hidden'}`}>
      <div className="absolute inset-0 bg-black opacity-75" onClick={onHide}></div>
      <div className="rounded-lg z-10 fade-in-from-top max-h-[95%] max-w-[95%] overflow-y-auto md:w-1/2">
        <div className="p-6 bg-gray-800 flex justify-between items-center text-2xl font-bold uppercase text-white">
          <h2>Ver detalles - ID: {documento.numero}</h2>
          <span className="cursor-pointer text-end text-white text-2xl" onClick={onHide}>
            <X />
          </span>
        </div>

        <div className='bg-white p-6 grid grid-cols-4 gap-4'>
          <div className="col-span-4 md:col-span-2 mb-4">
            <label className="block text-sm font-medium text-gray-600">Fecha:</label>
            <p>{documento.fecha}</p>
          </div>

          <div className="col-span-4 md:col-span-2 mb-4">
            <label className="block text-sm font-medium text-gray-600">Tipo:</label>
            <p>{documento.nombreTipo}</p>
          </div>

          <div className="col-span-4 mb-4">
            <label className="block text-sm font-medium text-gray-600">Voces:</label>
            <p>{documento.voces}</p>
          </div>

          <div className="col-span-4 mb-4">
            <label className="block text-sm font-medium text-gray-600">Dependencias Involucradas:</label>
            {documento.dependencias.length > 0 ? (
              <p>{documento.dependencias.map(dep => dep.dependencia).join(', ')}</p>
            ) : (
              <p>No hay dependencias</p>
            )}
          </div>


          <div className="col-span-4 md:col-span-1 mb-4">
            <button
              className="mt-2 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded hover:rounded-lg transition-all transform-200"
              onClick={() => openInternalUrlInNewTab(documento.path)}
            >
              Ver archivo
            </button>
          </div>

          {documento.pendiente && (
            <div className="col-span-4 md:col-span-3 mb-4 flex items-center">
              <p className='text-red-500 flex'>
                <AlertCircle className='mx-4'/>
                Este documento se encuentra pendiente.
              </p>
            </div>
          )}

          {documento.parentDocument && (
            <div className="col-span-4 mb-4">
              <label className="block text-sm font-medium text-gray-600">Documento relacionado:</label>
              <p>
                <span className='text-blue-600 cursor-pointer hover:text-blue-800 hover:underline' onClick={() => handleParentDocumentClick(documento.parentDocument)}>
                  Abrir detalles del documento ID: {documento.parentDocument.numero}
                </span>
              </p>
            </div>
          )}

          <div className="col-span-4">
            <div className="flex justify-end">
              <button type="button" onClick={onHide} className="p-2 px-4 mr-5 bg-slate-200 rounded hover:bg-slate-300 hover:rounded-lg transition-all transform-200">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalVer;
