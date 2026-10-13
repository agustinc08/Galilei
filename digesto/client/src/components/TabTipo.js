import React, { useState, useEffect } from 'react';
import { Edit, Trash2 } from 'react-feather';
import ConfirmationModal from './ConfirmationModal';
import '../css/fadein.css';

const TabTipo = () => {
  const [tipos, setTipos] = useState([]);
  const [tipoActual, setTipoActual] = useState({ id: null, nombre: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoToDelete, setTipoToDelete] = useState(null);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);

  const handleEditar = (id) => {
    const tipoEdit = tipos.find((tipo) => tipo.id === id);
    setTipoActual(tipoEdit);
  };

  const handleEliminar = (id) => {
    const tipoToDelete = tipos.find((tipo) => tipo.id === id);
    setTipoToDelete(tipoToDelete);
    setShowConfirmationModal(true);
  };

  const confirmarEliminacion = async () => {
    try {
      const response = await fetch('https://cncivil04.pjn.gov.ar/api/tipo/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: tipoToDelete.id }),
      });

      if (response.ok) {
        const nuevosTipos = tipos.filter((tipo) => tipo.id !== tipoToDelete.id);
        setTipos(nuevosTipos);
        setShowConfirmationModal(false);
      } else {
        console.error('Error deleting type:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error deleting type:', error.message);
    }
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleGuardar();
    }
  };
  const handleGuardar = async () => {
    if (!tipoActual.nombre.trim()) {
      alert('El campo nombre no puede estar vacío.');
      return;
    }

    try {
      let response;

      if (tipoActual.id) {
        // Si tiene un ID, es una edición
        response = await fetch(`https://cncivil04.pjn.gov.ar/api/tipo/edit`, {
          method: 'Post',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(tipoActual),
        });
      } else {

        console.log(tipoActual.nombre)
        response = await fetch('https://cncivil04.pjn.gov.ar/api/tipo/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nombre: tipoActual.nombre })
          ,
        });
      }
      if (response.ok) {

        // ... (código para actualizar el estado local después de la creación o actualización)

        // Llama a tu endpoint getAll para obtener la lista actualizada
        const getAllResponse = await fetch('https://cncivil04.pjn.gov.ar/api/tipo/getAll');

        if (getAllResponse.ok) {
          const tiposActualizados = await getAllResponse.json();

          // Actualiza el estado local con la lista completa
          setTipos(tiposActualizados);
        } else {
          console.error('Error al obtener la lista de tipos:', getAllResponse.status, getAllResponse.statusText);
        }

        // Limpia el estado de tipoActual después de guardar
        setTipoActual({ id: null, nombre: '' });
      } else {
        console.error('Error al guardar el tipo:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error al guardar el tipo', error.message);
    }
  };

  const filterTipos = () => {
    return tipos.filter((tipo) =>
      tipo.nombre.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  useEffect(() => {
    const obtenerTiposDesdeAPI = async () => {
      try {
        const response = await fetch('https://cncivil04.pjn.gov.ar/api/tipo/getAll');

        if (!response.ok) {
          throw new Error('Error al obtener los tipos');
        }

        const tiposDesdeAPI = await response.json();
        setTipos(tiposDesdeAPI);
      } catch (error) {
        console.error('Error en la solicitud HTTP:', error.message);
      }
    };

    obtenerTiposDesdeAPI();
  }, []);

  return (
    <div>
      <form className="mb-4 bg-gray-100 rounded-md shadow-lg p-4">
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-3 md:col-span-1 fade-in-from-left">
            <label>
              Buscar:
              <input
                id="buscar"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="border rounded p-2 w-full"
              />
            </label>
          </div>

          <div className="col-span-3 md:col-span-1 fade-in-from-left flex">
            <label>
              Nombre:
              <input
                id="nombre"
                type="text"
                value={tipoActual.nombre}
                onChange={(e) => setTipoActual({ ...tipoActual, nombre: e.target.value })}
                onKeyPress={handleKeyPress}
                className="border rounded p-2 w-full"
              />
            </label>
            <button type="button" onClick={handleGuardar} className="bg-blue-500 text-white py-2 px-4 rounded mx-2 mt-auto">
              Guardar
            </button>
          </div>
        </div>
      </form>

    {!tipos.lenght ? (
      <table className="w-full border-collapse border-none rounded-lg shadow-xl fade-in-from-top">
        <thead>
          <tr className="bg-gray-700 text-white">
            <th className="p-2 w-10/12 rounded-tl-lg text-start">Nombre</th>
            <th className="p-2 w-1/12">Editar</th>
            <th className="p-2 w-1/12 rounded-tr-lg">Eliminar</th>
          </tr>
        </thead>
        <tbody className="bg-white text-center">
          {filterTipos().map((tipo, index, array) => (
            <tr key={tipo.id} className="">
              <td className={`p-2 text-start ${index === array.length - 1 ? 'rounded-bl-lg' : ''}`}>{tipo.nombre}</td>
              <td className='p-2'>
                <button type="button" onClick={() => handleEditar(tipo.id)} className="bg-yellow-500 text-white p-2 rounded mx-5">
                  <Edit size={20} />
                </button>
              </td>
              <td className={`p-2 ${index === array.length - 1 ? 'rounded-br-lg' : ''}`}>
                <button type="button" onClick={() => handleEliminar(tipo.id)} className="bg-red-500 text-white p-2 rounded mx-5">
                  <Trash2 size={20} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      ) : (
      <div className="text-center my-20">
        <p className="font-bold text-gray-700">No se encontraron resultados.</p>
      </div>
      )}

      {showConfirmationModal && (
        <ConfirmationModal
          title="Confirmar Eliminación"
          message={`¿Estás seguro de que deseas eliminar "${tipoToDelete?.nombre}"?`}
          onCancel={() => setShowConfirmationModal(false)}
          onConfirm={confirmarEliminacion}
        />
      )}
    </div>
  );
};

export default TabTipo;
