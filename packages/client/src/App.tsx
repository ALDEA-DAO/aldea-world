import { useComponentValue } from "@latticexyz/react";
import { useMUD } from "./MUDContext";
import { singletonEntity } from "@latticexyz/store-sync/recs";

export const App = () => {
  const {
    components: { World },
    systemCalls: { createCharacter },
  } = useMUD();
  
  const world = useComponentValue(World, singletonEntity);

  return (
    <>
      <div>
        <h5>World Data</h5>
        <li>Archers: <span>{world?.characterPopulation[0] ?? "??"}</span></li>
        <li>Artisan: <span>{world?.characterPopulation[1] ?? "??"}</span></li>
        <li>Alchemist: <span>{world?.characterPopulation[2] ?? "??"}</span></li>
        <li>Blacksmith: <span>{world?.characterPopulation[3] ?? "??"}</span></li>
        <li>Chef: <span>{world?.characterPopulation[4] ?? "??"}</span></li>
        <li>Magician: <span>{world?.characterPopulation[5] ?? "??"}</span></li>
        <li>Merchant: <span>{world?.characterPopulation[6] ?? "??"}</span></li>
        <li>Priest: <span>{world?.characterPopulation[7] ?? "??"}</span></li>
        <li>Tailor: <span>{world?.characterPopulation[8] ?? "??"}</span></li>
        <li>Rebel: <span>{world?.characterPopulation[9] ?? "??"}</span></li>
        <li>Warrior: <span>{world?.characterPopulation[10] ?? "??"}</span></li>
        <li>Total Population: <span>{world?.totalPopulation ?? "??"}</span></li>
      </div>

      <div>
        <h5>Tribe Data</h5>
        <li>Amazonians Population: <span>{world?.tribePopulation[0] ?? "??"}</span></li>
        <li>Himalayans Population: <span>{world?.tribePopulation[1] ?? "??"}</span></li>
        <li>Poseidons Population: <span>{world?.tribePopulation[2] ?? "??"}</span></li>
        <li>Raes Population: <span>{world?.tribePopulation[3] ?? "??"}</span></li>
        <li>Tropicals Population: <span>{world?.tribePopulation[4] ?? "??"}</span></li>
      </div>

      <div>
        <h5>Functions</h5>
        <p>Choose a class: </p>
        <select 
          name="types" id="types" multiple 
        >
          <option value="random">Random</option>
          <option value="archer">Archer</option>
          <option value="artisan">Artisan</option>
          <option value="alchemist">Alchemist</option>
          <option value="blacksmith">Blacksmith</option>
          <option value="chef">Chef</option>
          <option value="magician">Magician</option>
          <option value="merchant">Merchant</option>
          <option value="priest">Priest</option>
          <option value="thief">Tailor</option>
          <option value="thief">Rebel</option>
          <option value="warrior">Warrior</option>
        </select>
        <br></br>
        <br></br>
        <button
          type="button"
          onClick={async (event) => {
            event.preventDefault();
            console.log("New total population value:", await createCharacter(0));
          }}
        >
          Create New Character
        </button>
      </div>
    </>
  );
};
