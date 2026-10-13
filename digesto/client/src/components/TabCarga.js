import React, { useState, useEffect } from 'react';
import { Minus, Plus } from 'react-feather';
import { ToastContainer, toast } from 'react-toastify';

const TabCarga = ({ onCancel, onSave }) => {
  const [reloadComponent, setReloadComponent] = useState(false);
  const [documentoFile, setDocumentoFile] = useState(null);
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState('');
  const [tipo, setTipo] = useState('');
  const [voces, setVoces] = useState('');
  const [pendiente, setPendiente] = useState(false); // Estado para el checkbox
  const [dependencias, setDependencias] = useState(['']);
  const [dependenciasEnBase, setDependenciasEnBase] = useState([]);
  const [tiposEnBase, setTiposEnBase] = useState([]);

  useEffect(() => {
    fetch('https://cncivil04.pjn.gov.ar/api/tipo/getAll')
      .then(response => response.json())
      .then(data => setTiposEnBase(data))
      .catch(error => console.error('Error al obtener dependencias ', error))
  },[])

  useEffect(() => {
    if (reloadComponent) {
      setReloadComponent(false);
      setDocumentoFile(null);
      obtenerUltimoNumero()
      setFecha('');
      setTipo('');
      setVoces('');
      setDependencias(['']);
      setPendiente(false)
    }
  }, [reloadComponent]);

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

  useEffect(() => {
    // Hacer la llamada al endpoint para obtener las dependencias
    fetch('https://cncivil04.pjn.gov.ar/api/dependencia/GetAll') // Reemplaza con tu endpoint real
      .then(response => response.json())
      .then(data => setDependenciasEnBase(data))
      .catch(error => console.error('Error al obtener dependencias', error));

  }, []);

  const handleAddDependencia = () => {
    if (dependencias.length < 5) {
      setDependencias([...dependencias, '']);
    }
  };

  const handleRemoveDependencia = (index) => {
    if (dependencias.length > 1) {
      const updatedDependencias = [...dependencias];
      updatedDependencias.splice(index, 1);
      setDependencias(updatedDependencias);
    }
  };

  const handleSave = async () => {
    try {
      // Verificar que la fecha esté presente
      if (!fecha) {
        alert('Por favor ingrese la fecha.');
        return;
      }

      // Verificar que se haya seleccionado un tipo
      if (!tipo) {
        alert('Por favor seleccione un tipo.');
        return;
      }

      // Verificar que se haya ingresado voces
      if (!voces) {
        alert('Por favor ingrese las voces.');
        return;
      }

      // Verificar que se haya adjuntado un PDF
      if (!documentoFile) {
        alert('Por favor adjunte un PDF.');
        return;
      }

      // Verificar dependencias repetidas
      const duplicatedDependencies = dependencias.filter((dep, index) => dependencias.indexOf(dep) !== index);
      if (duplicatedDependencies.length > 0) {
        alert(`Se han encontrado dependencias duplicadas: ${duplicatedDependencies.join(', ')}. Por favor, elimine las dependencias duplicadas.`);
        return;
      }

      const formData = new FormData();
      const fechaFormateada = new Date(fecha).toISOString();
      formData.append('fecha', fechaFormateada);
      formData.append('numero', numero)
      formData.append('tipo', tipo);
      formData.append('voz', voces);
      formData.append('dependencias', dependencias.join(','))
      formData.append('pdf', documentoFile);
      formData.append('pendiente', pendiente ? '1' : '0'); // Agregar el estado del checkbox

      const apiUrl = 'https://cncivil04.pjn.gov.ar/api/carga-de-datos/guardar-datos';

      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        toast.success('Documento cargado exitosamente');
        setReloadComponent(true);
      } else {
        alert('Error al guardar el documento: ' + response.status + ' - ' + response.statusText);
        toast.error('Error al guardar el documento: ' + response.status + ' - ' + response.statusText);
      }
    } catch (error) {
      alert('Error al guardar el documento: ' + error.message);
    }
  };

  if (reloadComponent) {
    return null; // Desmonta el componente
  }

  return (
    <>
      <div className="bg-gray-100 p-4 rounded-md shadow-lg mb-5">
        <div className="mx-auto grid grid-cols-3 gap-6">
          <div className="col-span-3 md:col-span-1 fade-in-from-left">
            <label>
              ID
              <input
                type="text"
                placeholder="Número"
                className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 "
                value={numero} // Usa el valor del estado en lugar de onChange
                readOnly // Para hacerlo de solo lectura
              />
            </label>
          </div>

          <div className="col-span-3 md:col-span-1 fade-in-from-left">
            <label>
              Fecha
              <input
                type="date"
                placeholder="Fecha"
                className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 "
                onChange={(e) => setFecha(e.target.value)}
              />
            </label>
          </div>

          <div className="col-span-3 md:col-span-1 fade-in-from-left">
            <label>
              Tipo
              <select className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 " onChange={(e) => setTipo(e.target.value)}>
                <option value="">Seleccionar Tipo</option>
                {tiposEnBase.map(tipo => (
                  <option key={tipo.id} value={tipo.id}>{tipo.nombre}</option>
                ))}
              </select>

            </label>

          </div>

          <div className="col-span-3 md:col-span-1 fade-in-from-left">
            <label>
              Voces
              <textarea
                placeholder="Voces"
                className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 min-h-[50px] max-h-[200px]"
                onChange={(e) => setVoces(e.target.value)}
              />
            </label>
          </div>

          <div className="col-span-3 md:col-span-1 fade-in-from-left">
            <label>
              Adjuntar PDF
              <div className="flex items-center mt-2">
                <input
                  type="file"
                  onChange={(e) => setDocumentoFile(e.target.files[0])}
                  className='file:p-2 file:rounded-md file:border-blue-500 file:bg-blue-50 file:text-blue-700 file:hover:cursor-pointer
                              file:hover:bg-blue-100 file:hover:border-blue-600 file:hover:text-blue-800 file:hover:rounded-lg file:transition-all file:transform-200'
                />
              </div>
            </label>
          </div>

          <div className="col-span-3 md:col-span-1 fade-in-from-left">
            <label>
              Dependencias involucradas
              {dependencias.map((dependencia, index) => (
                <div key={index} className="flex items-center mt-2">
                  <select
                    value={dependencia}
                    onChange={(e) => {
                      const updatedDependencias = [...dependencias];
                      updatedDependencias[index] = e.target.value;
                      setDependencias(updatedDependencias);
                    }}
                    className="border-2 border-transparent rounded p-2 w-80 focus:border-blue-500 focus:outline-blue-500 "
                  >
                    <option value="">Seleccionar Dependencia</option>
                    {dependenciasEnBase.map((dependenciaEnBase) => (
                      <option key={dependenciaEnBase.id} value={dependenciaEnBase.id}>
                        {dependenciaEnBase.descripcion}
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-center ml-2">
                    <button
                      className={`rounded-full p-1 border-2 ${dependencias.length >= 5 ? 'border-gray-100 text-gray-100' : 'border-green-500 text-green-500'}`}
                      onClick={handleAddDependencia}
                      disabled={dependencias.length >= 5}
                    >
                      <Plus size={16} />
                    </button>

                    {index > 0 && (
                      <button
                        className="rounded-full border-2 border-red-500 text-red-500 p-1 ml-4"
                        onClick={() => handleRemoveDependencia(index)}
                      >
                        <Minus size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </label>
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

          <div className="col-span-3 flex justify-end mt-2 fade-in-from-left">
            <button onClick={handleSave} className="rounded bg-blue-500 text-white p-2 px-4 mr-2 hover:bg-blue-600 hover:rounded-lg transition-all transform-200">
              Guardar
            </button>
            <button onClick={onCancel} className="rounded bg-gray-300 p-2 px-4 hover:bg-gray-400 hover:text-white hover:rounded-lg transition-all transform-200">
              Cancelar
            </button>
          </div>
        </div>
      </div>


    </>
  );
};

export default TabCarga;
