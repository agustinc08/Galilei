import React, { useState, useEffect } from 'react';
import { Search, Delete } from 'react-feather';

const Filters = ({ onSearch, onClear }) => {
  const [filtersKey, setFiltersKey] = useState(0); // Estado para forzar la re-renderización

  const [numero, setNumero] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [tipoOptions, setTipoOptions] = useState([]);
  const [selectedTipo, setSelectedTipo] = useState('');
  const [voces, setVoces] = useState('');
  const [buscarPDF, setBuscarPDF] = useState('');
  const [dependenciaOptions, setDependenciaOptions] = useState([]);
  const [selectedDependencia, setSelectedDependencia] = useState('');

  const handleTipoChange = (value) => {
    setSelectedTipo(value);
    delayedSearch();
  };

  const handleDependenciaChange = (value) => {
    setSelectedDependencia(value);
    delayedSearch();
  };

  const handleSearch = () => {
    const filters = {
      numero,
      fechaDesde,
      fechaHasta,
      tipo: selectedTipo,
      voces,
      buscarPDF,
      dependencia: selectedDependencia,
    };
    onSearch(filters);
  };

  const handleClear = () => {
    setNumero('');
    setSelectedTipo('');
    setVoces('');
    setFechaDesde('');
    setFechaHasta('');
    setBuscarPDF('');
    setSelectedDependencia('');
    setFiltersKey(prevKey => prevKey + 1); // Actualiza el key para forzar la re-renderización
    onClear()
  };
  useEffect(() => {
    delayedSearch();
  }, [selectedDependencia]);

  useEffect(() => {
    delayedSearch();
  }, [selectedTipo]);


  const debounce = (func, delay) => {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  };

  const delayedSearch = debounce(handleSearch, 50);

  useEffect(() => {
    fetch('https://cncivil04.pjn.gov.ar/api/tipo/getAll')
      .then(response => response.json())
      .then(data => {
        setTipoOptions(data);
      })
      .catch(error => console.error('Error al obtener opciones de tipos:', error));

    fetch('https://cncivil04.pjn.gov.ar/api/dependencia/GetAll')
      .then(response => response.json())
      .then(data => {
        setDependenciaOptions(data);
      })
      .catch(error => console.error('Error al obtener opciones de dependencias:', error));
  }, []);

  return (
    <div key={filtersKey} className="bg-gray-100 p-4 rounded-b-md rounded-tr-md shadow-lg mb-5">
      <div className="flex flex-wrap lg:flex-nowrap gap-4">
        <label className="block mb-2 w-full fade-in-from-left">
          Fecha desde
          <input
            type="date"
            placeholder="Fecha desde"
            className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 "
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
          />
        </label>

        <label className="block mb-2 w-full fade-in-from-left">
          Fecha hasta
          <input
            type="date"
            placeholder="Fecha hasta"
            className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 "
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
          />
        </label>
        <label className="block mb-2 w-full fade-in-from-left">
          Tipo
          <select
            className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 "
            value={selectedTipo}
            onChange={(e) => handleTipoChange(e.target.value)}
          >
            <option value="">Seleccionar Tipo</option>
            {tipoOptions.map((option, index) => (
              <option key={index} value={option.nombre}>{option.nombre}</option>
            ))}
          </select>

        </label>

        <label className="block mb-2 w-full fade-in-from-left">
          Voces
          <input
            type="text"
            placeholder="Voces"
            className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 "
            onChange={(e) => setVoces(e.target.value)}
            onKeyUp={delayedSearch}
          />
        </label>

        <label className="block mb-2 w-full fade-in-from-left">
          Buscar en PDF
          <input
            type="text"
            placeholder="Buscar en PDF"
            className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 "
            onChange={(e) => setBuscarPDF(e.target.value)}
            onKeyUp={delayedSearch}
          />
        </label>
        <label className="block mb-2 w-full fade-in-from-left">
          Dependencia
          <select
            className="border-2 border-transparent rounded p-2 w-full focus:border-blue-500 focus:outline-blue-500 "
            value={selectedDependencia}
            onChange={(e) => handleDependenciaChange(e.target.value)}
          >
            <option value="">Seleccionar Dependencia</option>
            {dependenciaOptions.map((option, index) => (
              <option key={index} value={option.id}>{option.descripcion}</option>
            ))}
          </select>
        </label>

        <div className='flex justify-end items-center w-full'>
          <div className='mt-2 fade-in-from-left'>
            <button onClick={handleSearch} className="rounded-full bg-blue-500 text-white p-3 mr-5 md:mr-0 hover:bg-blue-600">
              <Search />
            </button>
          </div>
          <div className='mt-2 fade-in-from-left'>
            <button onClick={handleClear} className="rounded-full bg-gray-400 text-white p-3 ml-3 md:ml-3 hover:bg-gray-500">
              <Delete />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Filters;