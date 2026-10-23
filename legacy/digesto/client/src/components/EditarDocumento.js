// EditarDocumento.js
import React, { useState, useEffect } from 'react';
import { Minus, Plus } from 'react-feather';

const EditarDocumento = ({ documento, onClose, onSave }) => {
  const [numero, setNumero] = useState(documento.numero);
  const [fecha, setFecha] = useState(documento.fecha);
  const [tipo, setTipo] = useState([documento.tipo]); // Inicializar con el tipo del documento
  const [otroTipo, setOtroTipo] = useState('');
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
    console.log('EditarDocumento montado');
    setNumero(documento.numero || '');
    const fechaFormateada = documento.fecha ? documento.fecha.split('/').reverse().join('-') : '';
    setFecha(fechaFormateada)
    setOtroTipo(documento.tipo === 'Otro' ? documento.otroTipo || '' : '');
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
      .then(data => {
        const tiposFromAPI = data.map(tipo => tipo.nombre);
        if (!tiposFromAPI.includes(documento.tipo)) {
          // Si el tipo del documento no está presente en los tipos de la API, agrégalo solo si no está ya en el estado tipo
          if (!tipo.includes(documento.tipo)) {
            setTipo(prevTipos => [...prevTipos, documento.tipo]);
          }
        }
        // Ahora actualiza el estado tipo con los tipos obtenidos de la API, excluyendo duplicados
        setTipo(prevTipos => [...prevTipos, ...tiposFromAPI.filter(tipo => !prevTipos.includes(tipo))]);
      })
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
        tipo: tipoSeleccionado === 'Otro' ? otroTipo : tipoSeleccionado,
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
        console.log('Documento guardado exitosamente');
      } else {
        console.error('Error al guardar el documento:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error al guardar el documento:', error.message);
    } finally {
      onClose();
      onSave();
    }
  };



  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" >
      <div className="absolute inset-0 bg-black opacity-75" onClick={handleOutsideClick}></div>
      <div className="bg-white p-8 rounded-lg z-10 grid grid-cols-4 gap-4 fade-in-from-top max-h-[98%] overflow-y-auto">
        <div className="col-span-4 mb-4 flex justify-between pb-3">
          <h2 className="text-2xl font-bold ">
            Editar Documento

          </h2>
          <span className="cursor-pointer text-end text-gray-700 text-2xl" onClick={handleOutsideClick}>
            &times;
          </span>
        </div>
        <div className="col-span-2 mb-3">
          <label className="block text-sm font-medium text-gray-600">ID:</label>
          <input
            type="text"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="mt-1 p-2 w-full border rounded-md shadow focus:shadow-lg"
            readOnly
          />
        </div>

        <div className="col-span-2 mb-3">
          <label className="block text-sm font-medium text-gray-600">Fecha:</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="mt-1 p-2 w-full border rounded-md shadow focus:shadow-lg"
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
              if (selectedValue !== 'Otro') {
                setOtroTipo('');
              }
            }}
            className="mt-1 p-2 w-full border rounded-md shadow focus:shadow-lg"
          >
            <option value="">Seleccione un tipo</option>
            {tipo.map((nombre, index) => (
              <option key={index} value={nombre}>{nombre}</option>
            ))}
            <option value="Otro">Otro</option>
          </select>
        </div>

        <div className="col-span-2 mb-3">
          <label className="block text-sm font-medium text-gray-600">Otro Tipo:</label>
          <input
            type="text"
            value={otroTipo}
            onChange={(e) => setOtroTipo(e.target.value)}
            className="mt-1 p-2 w-full border rounded-md shadow focus:shadow-lg"
            disabled={tipoSeleccionado !== 'Otro'}
          />
        </div>


        <div className="col-span-4 mb-3">
          <label className="block text-sm font-medium text-gray-600">Voces:</label>
          <textarea
            value={voces}
            onChange={(e) => setVoces(e.target.value)}
            className="mt-1 p-2 w-full border rounded-md shadow-md focus:shadow-xl"
          />
        </div>
        {documento.path && (
          <div className="mb-4">
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
            className="mt-1 p-2 w-full"
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
                className="mt-1 p-2 w-80 border rounded-md shadow focus:shadow-lg"
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
        <div className="rounded-md col-span-3 md:col-span-1 fade-in-from-left">
          <label>
            Pendiente
            <input
              type="checkbox"
              checked={pendiente}
              onChange={(e) => setPendiente(e.target.checked)}
              className="ml-2"
            />
          </label>
        </div>

        <div className="col-span-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleOutsideClick}
              className="p-2 px-4 mr-5 bg-slate-200 rounded-md hover:bg-slate-300"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditarDocumento;