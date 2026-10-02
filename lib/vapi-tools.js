// Definizioni dei tool che l'assistente vocale può chiamare.
// `path` è la rotta in routes/vapi.js (montata su /vapi).
module.exports = [
  {
    "name": "check_availability",
    "path": "availability",
    "description": "Verifica la disponibilità di tavoli per una data, orario e numero di persone. Usare quando il cliente chiede se c'è posto o prima di procedere con una prenotazione. Se il tool risponde che il locale è chiuso, che non c'è posto o che l'orario non è valido, riferisci il motivo al cliente e proponi SOLO le alternative indicate dal tool: non inventare orari.",
    "parameters": {
      "type": "object",
      "required": [
        "date"
      ],
      "properties": {
        "date": {
          "type": "string",
          "description": "Data in formato YYYY-MM-DD"
        },
        "time": {
          "type": "string",
          "description": "Orario in formato HH:MM"
        },
        "guests": {
          "type": "integer",
          "description": "Numero di persone"
        }
      }
    }
  },
  {
    "name": "create_reservation",
    "path": "reservations/create",
    "description": "Crea una prenotazione tavolo. Usare quando il cliente vuole prenotare e ha fornito nome, telefono, data, orario e numero ospiti. Se il tool risponde che il locale è chiuso, che non c'è posto o che l'orario non è valido, riferisci il motivo al cliente e proponi SOLO le alternative indicate dal tool: non inventare orari.",
    "parameters": {
      "type": "object",
      "required": [
        "customer_name",
        "customer_phone",
        "date",
        "time",
        "guests"
      ],
      "properties": {
        "customer_name": {
          "type": "string",
          "description": "Nome e cognome del cliente"
        },
        "customer_phone": {
          "type": "string",
          "description": "Numero di telefono del cliente"
        },
        "date": {
          "type": "string",
          "description": "Data prenotazione in formato YYYY-MM-DD"
        },
        "time": {
          "type": "string",
          "description": "Orario in formato HH:MM (es. 20:30)"
        },
        "guests": {
          "type": "integer",
          "description": "Numero di ospiti"
        },
        "notes": {
          "type": "string",
          "description": "Note opzionali: allergie, occasioni speciali, richieste particolari"
        }
      }
    }
  },
  {
    "name": "cancel_reservation",
    "path": "reservations/cancel",
    "description": "Cancella una prenotazione esistente. Usare quando il cliente vuole disdire. Identificare tramite ID, oppure nome+data o telefono+data.",
    "parameters": {
      "type": "object",
      "properties": {
        "reservation_id": {
          "type": "integer",
          "description": "ID della prenotazione (se noto)"
        },
        "customer_name": {
          "type": "string",
          "description": "Nome del cliente"
        },
        "customer_phone": {
          "type": "string",
          "description": "Telefono del cliente"
        },
        "date": {
          "type": "string",
          "description": "Data della prenotazione in formato YYYY-MM-DD"
        }
      }
    }
  },
  {
    "name": "list_reservations",
    "path": "reservations/list",
    "description": "Cerca le prenotazioni attive di un cliente tramite telefono o nome. Usare quando il cliente chiede di vedere le sue prenotazioni o prima di modificarne una.",
    "parameters": {
      "type": "object",
      "properties": {
        "customer_phone": {
          "type": "string",
          "description": "Telefono del cliente (preferito)"
        },
        "customer_name": {
          "type": "string",
          "description": "Nome del cliente (se non si ha il telefono)"
        },
        "date": {
          "type": "string",
          "description": "Data specifica in formato YYYY-MM-DD (opzionale per filtrare)"
        }
      }
    }
  },
  {
    "name": "update_reservation",
    "path": "reservations/update",
    "description": "Modifica una prenotazione esistente (data, orario, numero ospiti o note). Prima di usare questo tool, usa list_reservations per ottenere l'ID.",
    "parameters": {
      "type": "object",
      "properties": {
        "reservation_id": {
          "type": "integer",
          "description": "ID della prenotazione da modificare (preferito)"
        },
        "customer_phone": {
          "type": "string",
          "description": "Telefono del cliente per identificare la prenotazione"
        },
        "date": {
          "type": "string",
          "description": "Data attuale della prenotazione (per identificarla senza ID)"
        },
        "new_date": {
          "type": "string",
          "description": "Nuova data in formato YYYY-MM-DD"
        },
        "new_time": {
          "type": "string",
          "description": "Nuovo orario in formato HH:MM"
        },
        "guests": {
          "type": "integer",
          "description": "Nuovo numero di ospiti"
        },
        "notes": {
          "type": "string",
          "description": "Nuove note (sovrascrive le precedenti)"
        }
      }
    }
  },
  {
    "name": "get_menu",
    "path": "menu",
    "description": "Restituisce i piatti disponibili del menu con ID e prezzi. Usare quando il cliente chiede cosa c'è nel menu o prima di creare un ordine asporto.",
    "parameters": {
      "type": "object",
      "properties": {
        "category": {
          "type": "string",
          "description": "Categoria opzionale per filtrare",
          "enum": [
            "Antipasti",
            "Primi",
            "Secondi",
            "Dolci",
            "Bevande"
          ]
        }
      }
    }
  },
  {
    "name": "create_order",
    "path": "orders/create",
    "description": "Crea un ordine asporto. Usare quando il cliente vuole ordinare e ha fornito nome, telefono, orario ritiro e i piatti desiderati. Usare get_menu prima per ottenere gli ID piatto. Se il tool risponde che il locale è chiuso, che non c'è posto o che l'orario non è valido, riferisci il motivo al cliente e proponi SOLO le alternative indicate dal tool: non inventare orari.",
    "parameters": {
      "type": "object",
      "required": [
        "customer_name",
        "customer_phone",
        "pickup_date",
        "pickup_time",
        "items"
      ],
      "properties": {
        "customer_name": {
          "type": "string",
          "description": "Nome e cognome del cliente"
        },
        "customer_phone": {
          "type": "string",
          "description": "Numero di telefono"
        },
        "pickup_date": {
          "type": "string",
          "description": "Data di ritiro in formato YYYY-MM-DD"
        },
        "pickup_time": {
          "type": "string",
          "description": "Orario di ritiro in formato HH:MM"
        },
        "notes": {
          "type": "string",
          "description": "Note: allergie, modifiche ai piatti"
        },
        "items": {
          "type": "array",
          "description": "Lista dei piatti ordinati",
          "items": {
            "type": "object",
            "required": [
              "menu_item_id",
              "quantity"
            ],
            "properties": {
              "menu_item_id": {
                "type": "integer",
                "description": "ID del piatto (ottenuto da get_menu)"
              },
              "quantity": {
                "type": "integer",
                "description": "Quantità"
              }
            }
          }
        }
      }
    }
  },
  {
    "name": "list_orders",
    "path": "orders/list",
    "description": "Cerca gli ordini asporto attivi di un cliente tramite telefono o nome. Usare quando il cliente chiede di controllare un ordine o prima di modificarlo/annullarlo.",
    "parameters": {
      "type": "object",
      "properties": {
        "customer_phone": {
          "type": "string",
          "description": "Telefono del cliente (preferito)"
        },
        "customer_name": {
          "type": "string",
          "description": "Nome del cliente"
        },
        "pickup_date": {
          "type": "string",
          "description": "Data ritiro in formato YYYY-MM-DD (opzionale per filtrare)"
        }
      }
    }
  },
  {
    "name": "cancel_order",
    "path": "orders/cancel",
    "description": "Annulla un ordine asporto non ancora pronto o ritirato. Usare quando il cliente vuole cancellare un ordine. Prima usa list_orders per ottenere l'ID se non noto.",
    "parameters": {
      "type": "object",
      "properties": {
        "order_id": {
          "type": "integer",
          "description": "ID dell'ordine (preferito)"
        },
        "customer_phone": {
          "type": "string",
          "description": "Telefono del cliente per identificare l'ordine"
        },
        "pickup_date": {
          "type": "string",
          "description": "Data ritiro in formato YYYY-MM-DD (per identificare l'ordine senza ID)"
        }
      }
    }
  },
  {
    "name": "update_order",
    "path": "orders/update",
    "description": "Modifica l'orario o la data di ritiro di un ordine asporto, oppure le note. Solo ordini in stato 'in attesa' o 'in preparazione'. Prima usa list_orders per ottenere l'ID.",
    "parameters": {
      "type": "object",
      "properties": {
        "order_id": {
          "type": "integer",
          "description": "ID dell'ordine da modificare (preferito)"
        },
        "customer_phone": {
          "type": "string",
          "description": "Telefono del cliente per identificare l'ordine"
        },
        "pickup_date": {
          "type": "string",
          "description": "Data ritiro attuale in formato YYYY-MM-DD (per identificare senza ID)"
        },
        "new_pickup_date": {
          "type": "string",
          "description": "Nuova data di ritiro in formato YYYY-MM-DD"
        },
        "new_pickup_time": {
          "type": "string",
          "description": "Nuovo orario di ritiro in formato HH:MM"
        },
        "notes": {
          "type": "string",
          "description": "Nuove note (sovrascrive le precedenti)"
        }
      }
    }
  },
  {
    "name": "get_allergens",
    "path": "allergens",
    "description": "Restituisce la lista degli allergeni registrati nel sistema. Usare solo quando il cliente chiede esplicitamente degli allergeni presenti.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "create_complaint",
    "path": "complaints/create",
    "description": "Registra una segnalazione di un cliente che ha avuto un problema con un ordine (ordine sbagliato, ritardo, qualità, articoli mancanti). Usare quando il cliente chiama per lamentarsi di un ordine già effettuato.",
    "parameters": {
      "type": "object",
      "required": [
        "customer_name",
        "customer_phone",
        "type",
        "description"
      ],
      "properties": {
        "customer_name": {
          "type": "string",
          "description": "Nome e cognome del cliente"
        },
        "customer_phone": {
          "type": "string",
          "description": "Numero di telefono del cliente"
        },
        "type": {
          "type": "string",
          "description": "Tipo di problema",
          "enum": [
            "ordine_sbagliato",
            "ritardo",
            "qualita",
            "mancanza_articoli",
            "altro"
          ]
        },
        "description": {
          "type": "string",
          "description": "Descrizione del problema riportata dal cliente"
        },
        "order_id": {
          "type": "integer",
          "description": "ID dell'ordine di riferimento (se il cliente lo conosce)"
        }
      }
    }
  },
  {
    "name": "get_opening_hours",
    "path": "hours",
    "description": "Orari di apertura, giorni di chiusura, regole di prenotazione (preavviso, ultima prenotazione) e tempo di preparazione dell'asporto. Usare quando il cliente chiede se siete aperti, a che ora chiudete, o prima di proporre una data o un orario.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
];
