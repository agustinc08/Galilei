import React, { useState, useEffect } from 'react';
import { Minus, Plus, X } from 'react-feather';
import { ToastContainer, toast } from 'react-toastify';

const ModalAgregar = ({ documentoAsociado, show, onHide, onSave }) => {
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState('');
  const [tipo, setTipo] = useState([]);
  const [tipoSeleccionado, setTipoSeleccionado] = useState(null);
  const [voces, setVoces] = useState('');
  const [dependenciasSeleccionadas, setDependenciasSeleccionadas] = useState([]);
  const [opcionesDependencias, setOpcionesDependencias] = useState([]);
  const [numDependencias, setNumDependencias] = useState(1); // Inicialmente una dependencia
  const [archivo, setArchivo] = useState(null);
  const [pendiente, setPendiente] = useState(false); // Estado para el checkbox

  useEffect(() => {
    fetch('https://cncivil04.pjn.gov.ar/api/tipo/getAll')
      .then(response => response.json())
      .then(data => { setTipo(data)} )
      .catch(error => console.error('Error al obtener tipos ', error))
  }, []);

  useEffect(() => {
    fetch('https://cncivil04.pjn.gov.ar/api/dependencia/GetAll')
      .then(response => response.json())
      .then(data => {
        setOpcionesDependencias(data);
      })
      .catch(error => console.error('Error al obtener dependencias', error));

  }, []);

  const handleFileChange = (e) => {
    setArchivo(e.target.files[0]);
  };

  const obtenerUltimoNumero = () => {
    fetch('https://cncivil04.pjn.gov.ar/api/carga-de-datos/ultimo-numero')
      .then(response => {
        if (!response.ok) {
          throw new Error(`Error al cargar el número: ${response.status} - ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        setNumero(data);
      })
      .catch(error => {
        console.error(error.message);
      });
  };

  useEffect(() => {
    obtenerUltimoNumero(); // Llamar a la función al montar el componente
  }, []);

  const handleSave = async () => {
    try {
      // Verificar que la fecha esté presente
      if (!fecha) {
        toast.error('Por favor ingrese la fecha.');
        return;
      }
      // Verificar que se haya seleccionado un tipo
      if (!tipoSeleccionado) {
        toast.error('Por favor seleccione un tipo.');
        return;
      }

      // Verificar que se haya ingresado voces
      if (!voces) {
        toast.error('Por favor ingrese las voces.');
        return;
      }

      // Verificar que se haya adjuntado un PDF
      if (!archivo) {
        toast.error('Por favor adjunte un PDF.');
        return;
      }

      // Verificar dependencias repetidas
      const duplicatedDependencies = dependenciasSeleccionadas.filter((dep, index) => dependenciasSeleccionadas.indexOf(dep) !== index);
      if (duplicatedDependencies.length > 0) {
        alert(`Se han encontrado dependencias duplicadas: ${duplicatedDependencies.join(', ')}. Por favor, elimine las dependencias duplicadas.`);
        return;
      }

      const formData = new FormData();
      const fechaFormateada = new Date(fecha).toISOString();
      formData.append('pdf', archivo); // Agrega el documento al formulario
      formData.append('numero', numero)
      formData.append('tipo', tipoSeleccionado);
      formData.append('voz', voces);
      formData.append('fecha', fechaFormateada);
      formData.append('idDocAsociado', documentoAsociado.id)
      formData.append('dependencias', dependenciasSeleccionadas.join(','))
      formData.append('pendiente', pendiente)
      const apiUrl = 'https://cncivil04.pjn.gov.ar/api/carga-de-datos/asociar-nuevo-archivo';
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        toast.success("Documento agregado exitosamente");
      } else {
        console.error('Error al guardar el documento:', response.status, response.statusText);
        toast.error('Error al guardar el documento:', response.status, response.statusText);
      }
      onHide()
    } catch (error) {
      console.error('Error al guardar el documento:', error.message);
      toast.error('Error al guardar el documento:', error.message);
    }

  };

  return (
    <div className={`fixed inset-0 flex items-center justify-center z-50 ${show ? 'block' : 'hidden'}`}>
      <div className="absolute inset-0 bg-black opacity-75" onClick={onHide}></div>
      <div className="rounded-lg z-10 fade-in-from-top max-h-[95%] max-w-[95%] overflow-y-auto md:w-1/2">
        <div className="p-6 bg-gray-800 flex justify-between items-center text-2xl font-bold uppercase text-white">
          <h2>Agregar subdocumento - ID: {numero}</h2>
          <span className="cursor-pointer text-end text-white text-2xl" onClick={onHide}>
            <X />
          </span>
        </div>

        <div className='bg-white p-6 grid grid-cols-4 gap-4 '>
          <div className="col-span-2 mb-4">
            <label className="block text-sm font-medium text-gray-600">Fecha:</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="mt-1 p-2 w-full rounded-md shadow border focus:border-blue-500 focus:outline-blue-500"
            />
          </div>

          <div className="col-span-2 mb-4">
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

          <div className="col-span-4 mb-4">
            <label className="block text-sm font-medium text-gray-600">Voces:</label>
            <textarea
              value={voces}
              onChange={(e) => setVoces(e.target.value)}
              className="mt-1 p-2 w-full rounded-md shadow border focus:border-blue-500 focus:outline-blue-500"
            />
          </div>

          <div className="col-span-4 mb-4">
            <label className="block text-sm font-medium text-gray-600">Documento:</label>
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className='file:bg-blue-100 file:rounded file:hover:rounded-lg file:p-2 file:text-blue-800 file:border-blue-400
                  file:hover:cursor-pointer file:hover:bg-blue-200 file:hover:text-blue-900 file:hover:border-blue-500'
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
              </div>
            ))}
          </div>

          <div className="rounded-md col-span-3 md:col-span-1 fade-in-from-left">
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

          <div className="col-span-4">
            <div className="flex justify-end">
              <button type="button" onClick={onHide} className="p-2 px-4 mr-5 bg-gray-200 rounded hover:bg-gray-300 hover:rounded-lg transition-all transform-200">
                Cancelar
              </button>
              <button type="button" onClick={handleSave} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 hover:rounded-lg transition-all transform-200">
                Agregar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalAgregar;
