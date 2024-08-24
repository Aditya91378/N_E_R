const mongoose =require ("mongoose")

mongoose.connect("mongodb://localhost:27017/loginsignupDB")
.then(()=> {
    console.log("mongodb  connected");
})
.catch(()=>{
    console.log("failed to connect");
})

const LogInSchema= new mongoose.Schema({
    name:{
        type:String,
        reqired:true
    },
    password:{
        type:String,
        reqired:true
    },
    otp:{
        type:Number,
        required: false
    }
})

const collection=new mongoose .model("collection1", LogInSchema)

module.exports=collection