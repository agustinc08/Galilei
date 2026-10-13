// ModalEditar.js
import React, { useState, useEffect } from 'react';
import { Minus, Plus, X } from 'react-feather';
import { ToastContainer, toast } from 'react-toastify';

const ModalEditar = ({ documento, onClose, onSave }) => {
  const [numero, setNumero] = useState(documento.numero);
  const [fecha, setFecha] = useState(documento.fecha);
  const [tipo, setTipo] = useState([documento.tipo]); // Inicializar con el tipo del documento
  const [voces, setVoces] = useState(documento.voces);
  const [path, setPath] = useState(documento.path);
  const [dependencias, setDependencias] = useState(documento.dependencias || []);
  const [archivo, setArchivo] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [tipoSeleccionado, setTipoSeleccionado] = useState(documento.tipo);
  const [opcionesDependencias, setOpcionesDependencias] = useState([]);
  const [dependenciasSeleccionadas, setDependenciasSeleccionadas] = useState(documento.dependencias || ['']); // Inicializar con al menos una opción
  const [numDependencias, setNumDependencias] = useState(dependenciasSeleccionadas.length);
  const [pendiente, setPendiente] = useState(false); // Estado para el checkbox

  useEffect(() => {
    setNumero(documento.numero || '');
    const fechaFormateada = documento.fecha ? documento.fecha.split('/').reverse().join('-') : '';
    setFecha(fechaFormateada);
    setVoces(documento.voces || '');
    setPath(documento.path || '');
    setDependencias(documento.dependencias || []);
    setPendiente(documento.pendiente)
  }, [documento]);

  useEffect(() => {
    if (documento.dependencias && documento.dependencias.length > 0) {
      // Si hay dependencias en el documento, establecerlas como dependencias seleccionadas
      setDependenciasSeleccionadas(documento.dependencias.map(dependencia => dependencia.id));
      // Establecer el número de select según la cantidad de dependencias
      setNumDependencias(documento.dependencias.length);
    } else {
      // Si no hay dependencias, establecer al menos una opción para que el usuario pueda seleccionar
      setDependenciasSeleccionadas(['']);
      setNumDependencias(1);
    }
  }, [documento]);


  useEffect(() => {
    fetch('https://cncivil04.pjn.gov.ar/api/tipo/getAll')
      .then(response => response.json())
      .then(data => { setTipo(data)} )
      .catch(error => console.error('Error al obtener tipos ', error))
  }, []);

  useEffect(() => {
    // Cargar opciones de dependencias al montar el componente
    fetch('https://cncivil04.pjn.gov.ar/api/dependencia/GetAll')
      .then(response => response.json())
      .then(data => {
        setOpcionesDependencias(data);
      })
      .catch(error => console.error('Error al obtener dependencias', error));
  }, []);


  const handleOutsideClick = (e) => {
    if (isDirty) {
      e.preventDefault();
      e.stopPropagation();
      const confirmCancel = window.confirm('¿Desea cancelar la edición? Los cambios no guardados se perderán.');
      if (confirmCancel) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const handleFileChange = (e) => {
    setArchivo(e.target.files[0]);
    setIsDirty(true); // Indicar cambios sin guardar
  };

  const handleFieldChange = () => {
    setIsDirty(true); // Indicar cambios sin guardar
  };

  const handleSave = async () => {
    try {
      const formData = new FormData();

      if (archivo) { // Verifica si hay un archivo seleccionado
        formData.append('pdf', archivo);
      }

      const data = {
        numero: documento.numero,
        tipo: tipoSeleccionado,
        voz: voces,
        dependencias: dependenciasSeleccionadas.join(','),
        pendiente: pendiente === true ? 1 : 0
      };

      formData.append('numero', data.numero);
      formData.append('tipo', data.tipo);
      formData.append('voz', data.voz);
      formData.append('dependencias', data.dependencias);
      formData.append('pendiente', data.pendiente)
      const response = await fetch(`https://cncivil04.pjn.gov.ar/api/carga-de-datos/editar-datos/${documento.id}`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        toast.success("Documento editado exitosamente");
      } else {
        console.error('Error al guardar el documento:', response.status, response.statusText);
        toast.error('Error al guardar el documento:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error al guardar el documento:', error.message);
      toast.error('Error al guardar el documento:', error.message);
    } finally {
      onClose();
      onSave();
    }
  };



  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" >
      <div className="absolute inset-0 bg-black opacity-75" onClick={handleOutsideClick}></div>
      <div className="rounded-lg z-10 fade-in-from-top max-h-[95%] max-w-[95%] overflow-y-auto md:w-1/2">
        <div className="p-6 flex justify-between items-center text-white text-2xl font-bold uppercase bg-gray-800">
          <h2>Editar Documento - ID: {numero}</h2>
          <span className="cursor-pointer text-end text-white text-2xl" onClick={handleOutsideClick}>
            <X />
          </span>
        </div>

        <div className='bg-white p-6 grid grid-cols-4 gap-4'>
          <div className="col-span-2 mb-3">
            <label className="block text-sm font-medium text-gray-600">Fecha:</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="mt-1 p-2 w-full rounded-md shadow border focus:border-blue-500 focus:outline-blue-500"
              readOnly
            />
          </div>

          <div className="col-span-2 mb-3">
            <label className="block text-sm font-medium text-gray-600">Tipo:</label>
            <select
              value={tipoSeleccionado}
              onChange={(e) => {
                const selectedValue = e.target.value;
                setTipoSeleccionado(selectedValue);
              }}
              className="mt-1 p-2 w-full rounded-md shadow border focus:border-blue-500 focus:outline-blue-500"
            >
              <option value="">Seleccione un tipo</option>
              {tipo.map(tipo => (
                <option key={tipo.id} value={tipo.id}>{tipo.nombre}</option>
              ))}
            </select>
          </div>

          <div className="col-span-4 mb-3">
            <label className="block text-sm font-medium text-gray-600">Voces:</label>
            <textarea
              value={voces}
              onChange={(e) => setVoces(e.target.value)}
              className="mt-1 p-2 w-full rounded-md shadow border focus:border-blue-500 focus:outline-blue-500 min-h-[50px] max-h-[200px]"

            />
          </div>
          {documento.path && (
            <div className="col-span-4 mb-4">
              <label className="block text-sm font-medium text-gray-600">Documento precargado:</label>
              <div>{documento.path.split('/').pop()}</div>
            </div>
          )}

          <div className="col-span-4 mb-4">
            <label className="block text-sm font-medium text-gray-600">Seleccione un nuevo documento:</label>
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className="file:bg-blue-100 file:rounded file:hover:rounded-lg file:p-2 file:text-blue-800 file:border-blue-400
                file:hover:cursor-pointer file:hover:bg-blue-200 file:hover:text-blue-900 file:hover:border-blue-500"
            />
          </div>


          <div className="col-span-4 mb-4">
            <label className="block text-sm font-medium text-gray-600">Dependencias Involucradas:</label>
            {[...Array(numDependencias)].map((_, index) => (
              <div key={index} className="flex items-center mb-2">
                <select
                  value={dependenciasSeleccionadas[index] || ''}
                  onChange={(e) => {
                    const updatedDependencias = [...dependenciasSeleccionadas];
                    updatedDependencias[index] = e.target.value;
                    setDependenciasSeleccionadas(updatedDependencias);
                  }}
                  className="mt-1 p-2 w-80 rounded-md shadow border focus:border-blue-500 focus:outline-blue-500"
                >
                  <option value="">Seleccione una dependencia</option>
                  {opcionesDependencias.map((dependencia) => (
                    <option key={dependencia.id} value={dependencia.id}>{dependencia.descripcion}</option>
                  ))}
                </select>
                {index === numDependencias - 1 && ( // Agregar select solo si es el último
                  <>
                    <button
                      type="button"
                      onClick={() => setNumDependencias((prev) => prev + 1)}
                      className={`ml-2 p-1 border rounded-full
                  ${numDependencias >= 5 ? 'text-gray-500 cursor-not-allowed' : 'border-green-500 text-green-500 hover:text-green-700 '}`
                      }
                      disabled={numDependencias >= 5}
                    >
                      <Plus size={16} />
                    </button>

                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setNumDependencias((prev) => prev - 1);
                          const updatedDependencias = [...dependenciasSeleccionadas];
                          updatedDependencias.splice(index, 1);
                          setDependenciasSeleccionadas(updatedDependencias);
                        }}
                        className="ml-2 p-1 border rounded-full border-red-500 text-red-500 hover:text-red-700 hover:border-red-700"
                      >
                        <Minus size={16} />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="rounded-md col-span-2 fade-in-from-left flex items-center">
            <label className='flex items-center'>
              Pendiente
              <input
                type="checkbox"
                checked={pendiente}
                onChange={(e) => setPendiente(e.target.checked)}
                className="ml-2"
              />
            </label>
          </div>

          <div className="col-span-2">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleOutsideClick}
                className="p-2 px-4 mr-5 bg-slate-200 rounded hover:rounded-lg hover:bg-slate-300 transition-all transform-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:rounded-lg hover:bg-blue-600 transition-all transform-200"
              >
                Editar
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ModalEditar;